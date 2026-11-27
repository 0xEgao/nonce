import { ConfigService } from '@nestjs/config';
import { NewsletterContentFormat } from '@/common/enum';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';
import {
    findUnknownMergeTags,
    NEWSLETTER_MERGE_TAGS,
    NewsletterRenderService,
    RenderableNewsletter,
    sampleRecipient,
} from '@/newsletter/rendering/newsletter-render.service';
import { applyTracking } from '@/newsletter/tracking/newsletter-tracking.util';

// juice 12 is ESM-only. Node (22.12+) can require() it, which is how the app
// loads it, but Jest 29's own module loader cannot, so hand Jest the module
// through Node's native require.
jest.mock('juice', () =>
    process.getBuiltinModule('module').createRequire(__filename)('juice'),
);

// The tracking util belongs to another module; only how render calls it is
// under test here.
jest.mock('@/newsletter/tracking/newsletter-tracking.util', () => ({
    applyTracking: jest.fn((html: string) => `${html}<!-- tracked -->`),
    extractTrackableLinks: jest.fn(() => []),
}));

const API = 'https://api.bitshala.test';
const APP = 'https://app.bitshala.test';

function makeService(
    newsletterConfig: Record<string, unknown> = {},
): NewsletterRenderService {
    const config = {
        'app.baseUrl': API,
        'app.frontEndUrl': APP,
        ...newsletterConfig,
    } as Record<string, unknown>;
    const configService = {
        get: (key: string) => config[key],
        getOrThrow: (key: string) => config[key],
    } as unknown as ConfigService;
    return new NewsletterRenderService(
        new NewsletterUrlService(configService),
        configService,
    );
}

function newsletter(
    overrides: Partial<RenderableNewsletter> = {},
): RenderableNewsletter {
    return {
        id: 'nl-1',
        subject: 'Hello {{ first_name }}',
        preheader: null,
        contentFormat: NewsletterContentFormat.RICH_TEXT,
        content: '<h1>Big news</h1><p>Hi {{name}}, welcome.</p>',
        trackingEnabled: false,
        trackedLinks: [],
        lists: [{ id: 'list-1', slug: 'updates', name: 'Bitshala Updates' }],
        ...overrides,
    };
}

const alice = {
    email: 'alice@example.com',
    name: 'Alice Liddell',
    token: 'tok-alice',
};

describe('NewsletterRenderService', () => {
    afterEach(() => jest.clearAllMocks());

    describe('rich text', () => {
        it('wraps the content in the layout and inlines the editor styles', () => {
            const { html } = makeService().render(
                newsletter({
                    content: [
                        '<h1>Title</h1>',
                        '<h2>Sub</h2>',
                        '<p style="text-align: center">Centred</p>',
                        '<p><a data-button="true" href="https://bitshala.org/join">Join</a></p>',
                        '<ul><li><p>One</p></li></ul>',
                        '<blockquote><p>Quote</p></blockquote>',
                        '<img src="https://img.test/a.png" alt="A">',
                        '<p><code>x</code> <a href="https://bitshala.org">link</a></p>',
                    ].join(''),
                }),
                alice,
                { mode: 'send' },
            );

            expect(html).toMatch(/^<!DOCTYPE html>/);
            expect(html).toContain('width="600"');
            expect(html).toContain('color-scheme');
            expect(html).toMatch(/<h1 style="[^"]*font-size: 26px/);
            expect(html).toMatch(/<h2 style="[^"]*font-size: 21px/);
            // The editor's own alignment survives inlining.
            expect(html).toMatch(/<p style="[^"]*text-align: center;?"/);
            expect(html).toMatch(
                /<a data-button="true" href="https:\/\/bitshala.org\/join" style="[^"]*background-color: #f7931a/,
            );
            expect(html).toMatch(/<li style="[^"]*"><p style="margin: 0;?">/);
            expect(html).toMatch(/<blockquote style="[^"]*border-left: 3px/);
            expect(html).toMatch(/<img [^>]*style="[^"]*max-width: 100%/);
            expect(html).not.toMatch(/<img [^>]*height="auto"/);
            expect(html).toMatch(/<code style="[^"]*font-family: ui-monospace/);
            expect(html).toMatch(
                /<a href="https:\/\/bitshala.org" style="[^"]*color: #f9b233/,
            );
            // Only the media query is left in a <style>; the rest is inline.
            expect(html).not.toContain('.nl-content h1');
            expect(html).toContain('@media only screen');
        });

        it('styles exactly what the composer emits', () => {
            // Shapes reported by the TipTap composer.
            const { html } = makeService().render(
                newsletter({
                    content: [
                        '<h2 style="text-align: right">Right</h2>',
                        '<p>Line one<br>line two</p>',
                        '<ul><li><p>Item</p></li></ul>',
                        '<img src="https://img.test/a.png" alt="A">',
                        '<p style="text-align: center"><a target="_blank" rel="noopener noreferrer" data-button="true" href="https://bitshala.org/go">Go</a></p>',
                        '<p><a target="_blank" rel="noopener noreferrer" href="{{unsubscribe_url}}">Leave</a></p>',
                    ].join(''),
                }),
                alice,
                { mode: 'send' },
            );

            expect(html).toMatch(/<h2 style="[^"]*text-align: right;?"/);
            expect(html).toContain('Line one<br>line two');
            expect(html).toMatch(
                /<li style="[^"]*"><p style="margin: 0;?">Item/,
            );
            expect(html).toMatch(
                /<img [^>]*style="display: block; max-width: 100%; height: auto; margin: 0 auto 16px auto;/,
            );
            expect(html).toMatch(
                /<p style="[^"]*text-align: center;?"><a target="_blank" rel="noopener noreferrer" data-button="true" href="https:\/\/bitshala.org\/go" style="display: inline-block;[^"]*background-color: #f7931a/,
            );
            // The brace-delimited href survived juice and was resolved.
            expect(html).toContain(
                `href="${APP}/newsletter/unsubscribe?token=tok-alice&amp;n=nl-1"`,
            );
            expect(html).not.toContain('{{');
            expect(html).not.toContain('%7B');
        });

        it('builds a plain-text part without the preheader or images', () => {
            const { text } = makeService().render(
                newsletter({
                    preheader: 'Inbox teaser',
                    content:
                        '<h1>Title</h1><p>Read <a href="https://bitshala.org/post">the post</a>.</p><img src="https://img.test/a.png" alt="A">',
                }),
                alice,
                { mode: 'send' },
            );

            expect(text).toContain('Title');
            expect(text).toContain('the post [https://bitshala.org/post]');
            expect(text).not.toContain('Inbox teaser');
            expect(text).not.toContain('img.test');
            expect(text).toContain('Unsubscribe');
        });
    });

    describe('html', () => {
        const document =
            '<!doctype html><html><head><title>x</title></head><body class="mine"><p class="lead">Hi {{name}}</p></body></html>';

        it('sends the document as authored, adding only preheader and footer', () => {
            const { html } = makeService().render(
                newsletter({
                    contentFormat: NewsletterContentFormat.HTML,
                    content: document,
                    preheader: 'Teaser',
                }),
                alice,
                { mode: 'send' },
            );

            expect(html).toContain(
                '<body class="mine"><div class="nl-preheader"',
            );
            expect(html).toContain('<p class="lead">Hi Alice Liddell</p>');
            expect(html).not.toContain('nl-content');
            expect(html.indexOf('Unsubscribe')).toBeLessThan(
                html.indexOf('</body>'),
            );
            expect(html.indexOf('Unsubscribe')).toBeGreaterThan(
                html.indexOf('Hi Alice'),
            );
        });

        it('appends the footer to a fragment with no body tag', () => {
            const { html } = makeService().render(
                newsletter({
                    contentFormat: NewsletterContentFormat.HTML,
                    content: '<p>Fragment</p>',
                }),
                alice,
                { mode: 'send' },
            );
            expect(html.startsWith('<p>Fragment</p>')).toBe(true);
            expect(html).toContain('Manage preferences');
        });

        it('puts the preheader after the first complete <body> tag', () => {
            const template = makeService().buildTemplate(
                newsletter({
                    contentFormat: NewsletterContentFormat.HTML,
                    content:
                        '<html><BODY\n  data-x="1">one</BODY><body>two</body>',
                    preheader: 'Teaser',
                }),
            );
            expect(template).toMatch(
                /^<html><BODY\n {2}data-x="1"><div class="nl-preheader"[^>]*>Teaser/,
            );
        });

        it('puts the preheader first when <body has no closing >', () => {
            const template = makeService().buildTemplate(
                newsletter({
                    contentFormat: NewsletterContentFormat.HTML,
                    content: '<p>x</p><body class="a"',
                    preheader: 'Teaser',
                }),
            );
            expect(template).toMatch(/^<div class="nl-preheader"/);
        });

        it('places the preheader in linear time on 300 KB of unclosed <body', () => {
            const started = performance.now();
            const template = makeService().buildTemplate(
                newsletter({
                    contentFormat: NewsletterContentFormat.HTML,
                    content: '<body '.repeat(50_000),
                    preheader: 'Teaser',
                }),
            );
            expect(performance.now() - started).toBeLessThan(500);
            expect(template).toMatch(/^<div class="nl-preheader"/);
        });
    });

    describe('merge tags', () => {
        it('resolves whitespace-tolerant tags with HTML-escaped values', () => {
            const service = makeService();
            const { html, subject } = service.render(
                newsletter({
                    subject: 'For {{name}} & co',
                    content:
                        '<p>{{ name }}|{{first_name}}|{{  email  }}|{{unknown}}</p>',
                }),
                {
                    email: 'tom@example.com',
                    name: 'Tom <script>& Jerry',
                    token: 'tok',
                },
                { mode: 'send' },
            );

            expect(html).toContain(
                '>Tom &lt;script&gt;&amp; Jerry|Tom|tom@example.com|{{unknown}}</p>',
            );
            expect(html).not.toContain('<script>');
            // The subject is plain text, not HTML.
            expect(subject).toBe('For Tom <script>& Jerry & co');
        });

        it('falls back to "there" without a name', () => {
            const { html, subject } = makeService().render(
                newsletter({ content: '<p>Hi {{name}} / {{first_name}}</p>' }),
                { email: 'x@example.com', name: '  ', token: 'tok' },
                { mode: 'send' },
            );
            expect(html).toContain('>Hi there / there</p>');
            expect(subject).toBe('Hello there');
        });

        it('never evaluates template syntax in admin content', () => {
            const { html } = makeService().render(
                newsletter({
                    content: '<p><%= it.secret %> ${process.env.HOME}</p>',
                }),
                alice,
                { mode: 'send' },
            );
            expect(html).toContain('<%= it.secret %> ${process.env.HOME}');
        });

        it('resolves the subscriber links, including percent-encoded tags', () => {
            const { html } = makeService().render(
                newsletter({
                    content:
                        '<p><a href="{{unsubscribe_url}}">Leave</a> <a href="%7B%7Bpreferences_url%7D%7D">Prefs</a></p>',
                }),
                alice,
                { mode: 'send' },
            );
            expect(html).toContain(
                `href="${APP}/newsletter/unsubscribe?token=tok-alice&amp;n=nl-1"`,
            );
            expect(html).toContain(
                `href="${APP}/newsletter/preferences?token=tok-alice"`,
            );
        });
    });

    describe('findUnknownMergeTags', () => {
        it('resolves every tag it calls supported', () => {
            const content = NEWSLETTER_MERGE_TAGS.map(
                (tag) => `[{{ ${tag.toUpperCase()} }}]`,
            ).join('');
            const { html } = makeService().render(
                newsletter({ content }),
                alice,
                { mode: 'send' },
            );

            expect(findUnknownMergeTags([content])).toEqual([]);
            expect(html).not.toContain('{{');
        });

        it('returns what rendering would leave as written, once each, in order', () => {
            expect(
                findUnknownMergeTags([
                    'Hi {{firstname}} and {{ first name }}',
                    '<p>{{name}} {{}} {{<b>name</b>}} {{firstname}}</p>',
                ]),
            ).toEqual([
                '{{firstname}}',
                '{{ first name }}',
                '{{}}',
                '{{<b>name</b>}}',
            ]);
        });

        it('checks percent-encoded tags the way rendering decodes them', () => {
            expect(
                findUnknownMergeTags([
                    '<a href="https://x.test/?a=%7B%7Bemail%7D%7D&b=%7b%7b%20Name%20%7d%7d">ok</a>',
                    '<a href="https://x.test/?a=%7B%7Bemial%7D%7D&b=%7B%7Bfirst%20name%7D%7D">bad</a>',
                ]),
            ).toEqual(['%7B%7Bemial%7D%7D', '%7B%7Bfirst%20name%7D%7D']);
        });

        it('shortens a runaway tag in what it returns', () => {
            const [tag] = findUnknownMergeTags([`{{${'x'.repeat(500)}}}`]);
            expect(tag).toHaveLength(60);
            expect(tag.endsWith('…')).toBe(true);
        });

        it.each([
            ['{{', '{{ x '.repeat(60_000)],
            ['%7B%7B', '%7B%7B%20'.repeat(30_000)],
            ['{{ with long names', `{{${'a'.repeat(100)} `.repeat(3_000)],
        ])('runs in linear time on 300 KB of unclosed %s', (_label, text) => {
            const started = performance.now();
            findUnknownMergeTags([text]);
            expect(performance.now() - started).toBeLessThan(500);
        });
    });

    describe('footer', () => {
        it('is added when the content has no unsubscribe link', () => {
            const { html } = makeService({
                'email.newsletter.postalAddress': 'Bitshala\n12 <Main> St',
            }).render(newsletter(), alice, { mode: 'send' });

            expect(html).toContain('Unsubscribe</a>');
            expect(html).toContain('Manage preferences</a>');
            expect(html).toContain(
                `${APP}/newsletter/unsubscribe?token=tok-alice&amp;n=nl-1`,
            );
            expect(html).toMatch(/Bitshala<br ?\/?>12 &lt;Main&gt; St/);
        });

        it('leaves the postal address out when none is configured', () => {
            const { html } = makeService({
                'email.newsletter.postalAddress': null,
            }).render(newsletter(), alice, { mode: 'send' });
            expect(html).toContain('Unsubscribe</a>');
            expect(html).not.toMatch(/<br ?\/?>/);
        });

        it('is left out when the content brings its own unsubscribe link', () => {
            const { html } = makeService().render(
                newsletter({
                    content:
                        '<p>Bye: <a href="{{ unsubscribe_url }}">unsubscribe here</a></p>',
                }),
                alice,
                { mode: 'send' },
            );
            expect(html).not.toContain('Manage preferences');
            expect(html).toContain('unsubscribe here');
        });
    });

    describe('preheader', () => {
        it('is a hidden block right after <body>, escaped', () => {
            const { html } = makeService().render(
                newsletter({ preheader: 'Big <news> for {{name}}' }),
                alice,
                { mode: 'send' },
            );
            expect(html).toMatch(
                /<body[^>]*>\s*<div class="nl-preheader" style="display: ?none;[^"]*">Big &lt;news&gt; for Alice Liddell/,
            );
        });

        it('is absent when blank', () => {
            const { html } = makeService().render(
                newsletter({ preheader: '   ' }),
                alice,
                { mode: 'send' },
            );
            expect(html).not.toContain('nl-preheader');
        });
    });

    describe('headers', () => {
        it('carries one-click unsubscribe, bulk precedence and the list id', () => {
            const { headers } = makeService().render(newsletter(), alice, {
                mode: 'send',
            });
            expect(headers).toEqual({
                'List-Unsubscribe': `<${API}/newsletter/public/unsubscribe/one-click?token=tok-alice&n=nl-1>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                Precedence: 'bulk',
                'List-ID': '"Bitshala Updates" <updates.app.bitshala.test>',
            });
        });

        it('has no List-ID unless exactly one list is targeted', () => {
            const service = makeService();
            const twoLists = service.render(
                newsletter({
                    lists: [
                        { id: 'a', slug: 'a', name: 'A' },
                        { id: 'b', slug: 'b', name: 'B' },
                    ],
                }),
                alice,
                { mode: 'send' },
            );
            const adHocOnly = service.render(newsletter({ lists: [] }), alice, {
                mode: 'send',
            });
            expect(twoLists.headers['List-ID']).toBeUndefined();
            expect(adHocOnly.headers['List-ID']).toBeUndefined();
        });
    });

    describe('modes', () => {
        it('test: [TEST] subject, inert links even if a real token is passed', () => {
            const { subject, html, headers } = makeService().render(
                newsletter({ trackingEnabled: true, trackedLinks: ['x'] }),
                alice,
                { mode: 'test', deliveryId: 'd-1' },
            );
            expect(subject).toBe('[TEST] Hello Alice');
            expect(html).toContain('token=preview');
            expect(html).not.toContain('tok-alice');
            expect(headers['List-Unsubscribe']).toContain('token=preview');
            expect(applyTracking).not.toHaveBeenCalled();
        });

        it('preview: sample recipient, inert links, no tracking', () => {
            const { subject, html } = makeService().render(
                newsletter({ trackingEnabled: true }),
                sampleRecipient(),
                { mode: 'preview' },
            );
            expect(subject).toBe('Hello Satoshi');
            expect(html).toContain('Hi Satoshi Nakamoto');
            expect(html).toContain('token=preview');
            expect(applyTracking).not.toHaveBeenCalled();
        });

        it('send with tracking on: tracks the frozen links after merge tags', () => {
            const { html, text } = makeService().render(
                newsletter({
                    trackingEnabled: true,
                    trackedLinks: ['https://bitshala.org/a'],
                    content: '<p><a href="https://bitshala.org/a">A</a></p>',
                }),
                alice,
                { mode: 'send', deliveryId: 'd-1' },
            );

            expect(applyTracking).toHaveBeenCalledTimes(1);
            const [trackedInput, options] = (applyTracking as jest.Mock).mock
                .calls[0];
            expect(trackedInput).not.toContain('{{');
            expect(options.links).toEqual(['https://bitshala.org/a']);
            expect(options.clickUrl(0)).toBe(
                `${API}/newsletter/public/t/c/d-1/0`,
            );
            expect(options.pixelUrl).toBe(
                `${API}/newsletter/public/t/o/d-1.gif`,
            );
            expect(html).toContain('<!-- tracked -->');
            // The text part comes from the untracked HTML.
            expect(text).not.toContain('tracked');
        });

        it('send with tracking off: links untouched', () => {
            makeService().render(newsletter(), alice, {
                mode: 'send',
                deliveryId: 'd-1',
            });
            expect(applyTracking).not.toHaveBeenCalled();
        });

        it('a tracked send without a delivery id is a bug, not a silent skip', () => {
            expect(() =>
                makeService().render(
                    newsletter({ trackingEnabled: true }),
                    alice,
                    { mode: 'send' },
                ),
            ).toThrow();
        });
    });

    describe('buildTemplate', () => {
        it('leaves merge tags unresolved, so per-recipient links are never tracked', () => {
            const template = makeService().buildTemplate(newsletter());
            expect(template).toContain('href="{{unsubscribe_url}}"');
            expect(template).toContain('href="{{preferences_url}}"');
            expect(template).toContain('Hi {{name}}');
        });
    });
});
