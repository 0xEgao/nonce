import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compile } from 'html-to-text';
import juice from 'juice';
import { MailingList } from '@/entities/mailing-list.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { NewsletterContentFormat } from '@/common/enum';
import { NEWSLETTER_PREVIEW_TOKEN } from '@/newsletter/newsletter.constants';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';
import { readNewsletterSettings } from '@/newsletter/newsletter-settings';
import { applyTracking } from '@/newsletter/tracking/newsletter-tracking.util';
import { escapeHtml } from '@/newsletter/newsletter.utils';
import {
    layoutFooterHtml,
    PREHEADER_CLASS,
    preheaderHtml,
    richTextDocument,
    standaloneFooterHtml,
} from '@/newsletter/rendering/newsletter-layout';

/**
 * `send`: a real delivery; tracking applies when the newsletter has it on.
 * `test`: a test send; `[TEST] ` subject prefix, inert links, no tracking.
 * `preview`: the admin preview; inert links, no tracking.
 */
export type NewsletterRenderMode = 'send' | 'test' | 'preview';

export interface RenderRecipient {
    email: string;
    name: string | null;
    /**
     * The subscriber's token, for the unsubscribe and preferences links.
     * NEWSLETTER_PREVIEW_TOKEN in previews and test sends.
     */
    token: string;
}

export interface RenderOptions {
    mode: NewsletterRenderMode;
    /** Required in `send` mode: the one-click, pixel and click URLs carry it. */
    deliveryId?: string;
}

export interface RenderedNewsletter {
    subject: string;
    html: string;
    text: string;
    headers: Record<string, string>;
}

/**
 * What rendering reads from a newsletter. A preview merges its unsaved
 * overrides into the stored newsletter and passes that.
 */
export type RenderableNewsletter = Pick<
    Newsletter,
    | 'id'
    | 'subject'
    | 'preheader'
    | 'contentFormat'
    | 'content'
    | 'trackingEnabled'
    | 'trackedLinks'
> & {
    lists: Pick<MailingList, 'id' | 'slug' | 'name'>[];
};

export type NewsletterTemplateSource = Pick<
    RenderableNewsletter,
    'subject' | 'preheader' | 'contentFormat' | 'content'
>;

export const NEWSLETTER_SAMPLE_RECIPIENT_NAME = 'Satoshi Nakamoto';
export const NEWSLETTER_SAMPLE_RECIPIENT_EMAIL = 'satoshi@example.com';

/** Who previews and test sends are addressed to; their links lead nowhere. */
export function sampleRecipient(
    email: string = NEWSLETTER_SAMPLE_RECIPIENT_EMAIL,
): RenderRecipient {
    return {
        email,
        name: NEWSLETTER_SAMPLE_RECIPIENT_NAME,
        token: NEWSLETTER_PREVIEW_TOKEN,
    };
}

/** The merge tags rendering resolves; any other `{{ … }}` goes out as written. */
export const NEWSLETTER_MERGE_TAGS = [
    'name',
    'first_name',
    'email',
    'unsubscribe_url',
    'preferences_url',
] as const;
type MergeTag = (typeof NEWSLETTER_MERGE_TAGS)[number];

const MERGE_TAG_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/gi;
const UNSUBSCRIBE_TAG_PATTERN = /\{\{\s*unsubscribe_url\s*\}\}/i;
// An editor or HTML tool may percent-encode the braces inside an href.
const ENCODED_MERGE_TAG_PATTERN = new RegExp(
    `%7B%7B(?:\\s|%20)*(${NEWSLETTER_MERGE_TAGS.join('|')})(?:\\s|%20)*%7D%7D`,
    'gi',
);

// Anything written as a merge tag, supported or not, plain or encoded. Each
// scan stops at the next brace or `%`, so neither can run away on long input.
const ANY_MERGE_TAG_PATTERN = /\{\{([^{}]*)\}\}/g;
const ANY_ENCODED_MERGE_TAG_PATTERN = /%7B%7B((?:%20|[\w\s.-])*)%7D%7D/gi;

const UNKNOWN_TAG_DISPLAY_LENGTH = 60;

/**
 * The merge tags in `texts` that rendering would leave as written, such as a
 * `{{firstname}}` typo, without repeats and in order of appearance.
 */
export function findUnknownMergeTags(texts: string[]): string[] {
    const supported = new Set<string>(NEWSLETTER_MERGE_TAGS);
    const unknown = new Set<string>();
    const check = (tag: string, inner: string) => {
        if (!supported.has(inner.trim().toLowerCase())) {
            unknown.add(
                tag.length > UNKNOWN_TAG_DISPLAY_LENGTH
                    ? `${tag.slice(0, UNKNOWN_TAG_DISPLAY_LENGTH - 1)}…`
                    : tag,
            );
        }
    };
    for (const text of texts) {
        for (const [tag, inner] of text.matchAll(ANY_MERGE_TAG_PATTERN)) {
            check(tag, inner);
        }
        for (const [tag, inner] of text.matchAll(
            ANY_ENCODED_MERGE_TAG_PATTERN,
        )) {
            check(tag, inner.replace(/%20/gi, ' '));
        }
    }
    return [...unknown];
}

const JUICE_OPTIONS = {
    // Writes height="auto" onto images otherwise, which is not a valid value.
    applyHeightAttributes: false,
};

const toText = compile({
    wordwrap: 80,
    selectors: [
        { selector: `.${PREHEADER_CLASS}`, format: 'skip' },
        { selector: 'img', format: 'skip' },
        { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
        { selector: 'h1', options: { uppercase: false } },
        { selector: 'h2', options: { uppercase: false } },
        { selector: 'h3', options: { uppercase: false } },
    ],
});

@Injectable()
export class NewsletterRenderService {
    private readonly postalAddress: string | null;
    private readonly listIdDomain: string;
    // A send renders one newsletter for every recipient in a row, and the
    // layout plus CSS inlining is the expensive part; the merge tags are not.
    private cachedTemplate: { key: string; html: string } | null = null;

    constructor(
        private readonly urlService: NewsletterUrlService,
        configService: ConfigService,
    ) {
        this.postalAddress =
            readNewsletterSettings(configService).postalAddress;
        this.listIdDomain = hostnameOf(urlService.getFrontendUrl());
    }

    render(
        newsletter: RenderableNewsletter,
        recipient: RenderRecipient,
        options: RenderOptions,
    ): RenderedNewsletter {
        const sending = options.mode === 'send';
        // Previews and tests never carry a real token, whatever the caller
        // passed: a forwarded test email must not unsubscribe anyone.
        const token = sending ? recipient.token : NEWSLETTER_PREVIEW_TOKEN;
        const values = this.mergeValues(newsletter.id, recipient, token);

        const html = resolveMergeTags(
            this.buildTemplate(newsletter),
            values,
            escapeHtml,
        );
        const subject = resolveMergeTags(newsletter.subject, values, (v) =>
            v.replace(/\s+/g, ' '),
        ).trim();

        let finalHtml = html;
        if (sending && newsletter.trackingEnabled) {
            const deliveryId = options.deliveryId;
            if (!deliveryId) {
                throw new Error('A tracked send needs the delivery id');
            }
            finalHtml = applyTracking(html, {
                links: newsletter.trackedLinks,
                clickUrl: (index) =>
                    this.urlService.clickUrl(deliveryId, index),
                pixelUrl: this.urlService.openPixelUrl(deliveryId),
            });
        }

        return {
            subject: options.mode === 'test' ? `[TEST] ${subject}` : subject,
            html: finalHtml,
            text: toText(html),
            headers: this.headers(newsletter, token),
        };
    }

    /**
     * The full HTML with layout, preheader and footer, but merge tags still
     * unresolved: the same for every recipient. Sending extracts the tracked
     * links from this once, so per-recipient links are never among them.
     */
    buildTemplate(newsletter: NewsletterTemplateSource): string {
        const key = JSON.stringify([
            newsletter.contentFormat,
            newsletter.subject,
            newsletter.preheader,
            newsletter.content,
            this.postalAddress,
        ]);
        if (this.cachedTemplate?.key === key) return this.cachedTemplate.html;

        const content = newsletter.content.replace(
            ENCODED_MERGE_TAG_PATTERN,
            (_match, tag: string) => `{{${tag.toLowerCase()}}}`,
        );
        const withFooter = !UNSUBSCRIBE_TAG_PATTERN.test(content);
        const preheader = newsletter.preheader?.trim()
            ? preheaderHtml(newsletter.preheader.trim())
            : '';

        let html: string;
        if (newsletter.contentFormat === NewsletterContentFormat.HTML) {
            // Sent as authored: only the preheader and footer are added.
            html = insertAfterBodyOpen(content, preheader);
            if (withFooter) {
                html = insertBeforeBodyClose(
                    html,
                    standaloneFooterHtml(this.postalAddress),
                );
            }
        } else {
            html = juice(
                richTextDocument({
                    title: newsletter.subject,
                    preheaderHtml: preheader,
                    contentHtml: content,
                    footerHtml: withFooter
                        ? layoutFooterHtml(this.postalAddress)
                        : null,
                }),
                JUICE_OPTIONS,
            );
        }

        this.cachedTemplate = { key, html };
        return html;
    }

    private mergeValues(
        newsletterId: string,
        recipient: RenderRecipient,
        token: string,
    ): Map<string, string> {
        const name = recipient.name?.trim() || null;
        const values: Record<MergeTag, string> = {
            name: name ?? 'there',
            first_name: name?.split(/\s+/)[0] ?? 'there',
            email: recipient.email,
            unsubscribe_url: this.urlService.unsubscribeUrl(
                token,
                newsletterId,
            ),
            preferences_url: this.urlService.preferencesUrl(token),
        };
        return new Map(Object.entries(values));
    }

    private headers(
        newsletter: RenderableNewsletter,
        token: string,
    ): Record<string, string> {
        const headers: Record<string, string> = {
            // RFC 8058: mail clients POST here; Gmail and Yahoo require it
            // for bulk senders.
            'List-Unsubscribe': `<${this.urlService.oneClickUnsubscribeUrl(token, newsletter.id)}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            Precedence: 'bulk',
        };
        if (newsletter.lists.length === 1) {
            const [list] = newsletter.lists;
            const label = list.name.replace(/["\\<>\r\n]/g, '').trim();
            headers['List-ID'] =
                `"${label}" <${list.slug}.${this.listIdDomain}>`;
        }
        return headers;
    }
}

/** Plain replacement; unknown tags are left as written. */
function resolveMergeTags(
    template: string,
    values: Map<string, string>,
    encode: (value: string) => string,
): string {
    return template.replace(MERGE_TAG_PATTERN, (match, tag: string) => {
        const value = values.get(tag.toLowerCase());
        return value === undefined ? match : encode(value);
    });
}

function insertAfterBodyOpen(html: string, snippet: string): string {
    if (!snippet) return html;
    // The first `<body` and the `>` after it. A `<body\b[^>]*>` regex would
    // rescan to the end of the document from every `<body` that has no `>`
    // after it, which is quadratic; if the first has none, neither has any
    // later one.
    const bodyOpen = /<body\b/i.exec(html);
    const close = bodyOpen ? html.indexOf('>', bodyOpen.index) : -1;
    if (close === -1) return snippet + html;
    return html.slice(0, close + 1) + snippet + html.slice(close + 1);
}

function insertBeforeBodyClose(html: string, snippet: string): string {
    const index = html.toLowerCase().lastIndexOf('</body>');
    if (index === -1) return html + snippet;
    return html.slice(0, index) + snippet + html.slice(index);
}

function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname || 'bitshala.org';
    } catch {
        return 'bitshala.org';
    }
}
