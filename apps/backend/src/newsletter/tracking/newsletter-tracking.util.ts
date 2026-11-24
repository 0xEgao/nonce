import { escapeHtml } from '@/newsletter/newsletter.utils';

export interface ApplyTrackingOptions {
    /** The newsletter's frozen `trackedLinks`; a link's index is its click index. */
    links: string[];
    clickUrl: (index: number) => string;
    pixelUrl: string;
}

// `<a` followed by whitespace, `/` or `>`, so `<abbr>` and `<article>` do not
// match. Where the tag ends is worked out by `tagEnds`.
const ANCHOR_OPEN = /<a(?=[\s/>])/gi;

// One attribute: its name, then an optional double-quoted, single-quoted or
// unquoted value. Walking attributes in order is what keeps an `href` that
// sits inside another attribute's value (`title="href='x'"`) from matching.
const ATTRIBUTE =
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
};

const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g;

// The unsubscribe and preferences pages act on a per-recipient token, so they
// are never routed through the click redirect (unresolved `{{...}}` tags are
// already skipped; this catches ones that were resolved before extraction).
const UNTRACKED_PATH =
    /\/newsletter\/(?:unsubscribe|preferences|public\/unsubscribe)(?:\/|$)/i;

interface AnchorHref {
    /** Offset of the whole `href=...` attribute in the html. */
    start: number;
    end: number;
    quote: '"' | "'" | '';
    /** Entity-decoded and trimmed, the way a browser reads the attribute. */
    value: string;
}

function decodeEntities(value: string): string {
    return value.replace(
        ENTITY,
        (
            match: string,
            decimal: string | undefined,
            hex: string | undefined,
            named: string | undefined,
        ) => {
            if (named) return NAMED_ENTITIES[named];
            const codePoint =
                decimal !== undefined
                    ? Number.parseInt(decimal, 10)
                    : Number.parseInt(hex as string, 16);
            const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
            return codePoint > 0 && codePoint <= 0x10ffff && !isSurrogate
                ? String.fromCodePoint(codePoint)
                : match;
        },
    );
}

/** An absolute http(s) URL with a host; the only kind a click may redirect to. */
export function isHttpUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    if (!/^https?:\/\/[^\s/?#]/i.test(value)) return false;
    try {
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

function isTrackableLink(value: string): boolean {
    return (
        isHttpUrl(value) &&
        !value.includes('{{') &&
        !UNTRACKED_PATH.test(new URL(value).pathname)
    );
}

/**
 * `ends[i]`: where a tag whose attributes start at `i` ends, i.e. the first
 * `>` from `i` on that is not inside a quoted attribute value (a quoted value
 * may contain `>`); -1 when there is none, as with an unbalanced quote.
 * Filled right to left in one pass. Scanning forward from each `<a` instead
 * would rescan to the end of the document from every unterminated one, which
 * is quadratic.
 */
function tagEnds(html: string): Int32Array {
    const ends = new Int32Array(html.length + 1);
    ends[html.length] = -1;
    // Where the next `"` and `'` after `i` are.
    let nextDouble = -1;
    let nextSingle = -1;
    for (let i = html.length - 1; i >= 0; i--) {
        const char = html[i];
        if (char === '>') {
            ends[i] = i;
        } else if (char === '"' || char === "'") {
            // The value runs to the matching quote; the tag goes on after it.
            const close = char === '"' ? nextDouble : nextSingle;
            ends[i] = close === -1 ? -1 : ends[close + 1];
            if (char === '"') nextDouble = i;
            else nextSingle = i;
        } else {
            ends[i] = ends[i + 1];
        }
    }
    return ends;
}

/**
 * Every complete `<a ...>` tag, in document order: where its attributes
 * start, and the attributes themselves. A tag with an unbalanced quote is
 * skipped and stays untracked.
 */
function* findAnchorTags(
    html: string,
): Generator<{ attributesStart: number; attributes: string }> {
    const open = new RegExp(ANCHOR_OPEN);
    let ends: Int32Array | undefined;
    for (let match = open.exec(html); match; match = open.exec(html)) {
        ends ??= tagEnds(html);
        const attributesStart = match.index + '<a'.length;
        const end = ends[attributesStart];
        if (end === -1) continue;
        yield { attributesStart, attributes: html.slice(attributesStart, end) };
        // Anything inside the tag, `<a` in a quoted value included, is part
        // of it.
        open.lastIndex = end + 1;
    }
}

/** The `href` of every `<a>` tag, in document order. Other tags are ignored. */
function* findAnchorHrefs(html: string): Generator<AnchorHref> {
    for (const { attributesStart, attributes } of findAnchorTags(html)) {
        for (const attribute of attributes.matchAll(ATTRIBUTE)) {
            if (attribute[1].toLowerCase() !== 'href') continue;
            const raw = attribute[2] ?? attribute[3] ?? attribute[4];
            if (raw !== undefined) {
                const start = attributesStart + attribute.index;
                yield {
                    start,
                    end: start + attribute[0].length,
                    quote:
                        attribute[2] !== undefined
                            ? '"'
                            : attribute[3] !== undefined
                              ? "'"
                              : '',
                    value: decodeEntities(raw).trim(),
                };
            }
            // A browser uses the first `href` and ignores any repeat.
            break;
        }
    }
}

/**
 * The distinct http(s) links in `html` worth tracking, in document order.
 * Unsubscribe and preferences links are never tracked, nor is any link that
 * still holds a merge tag: a per-recipient URL has no single value to freeze.
 */
export function extractTrackableLinks(html: string): string[] {
    const links = new Set<string>();
    for (const { value } of findAnchorHrefs(html)) {
        if (isTrackableLink(value)) links.add(value);
    }
    return [...links];
}

/**
 * Rewrites every link found in `options.links` to its click URL and appends
 * the open pixel.
 */
export function applyTracking(
    html: string,
    options: ApplyTrackingOptions,
): string {
    const indexByLink = new Map<string, number>();
    options.links.forEach((link, index) => {
        if (!indexByLink.has(link)) indexByLink.set(link, index);
    });

    let tracked = '';
    let cursor = 0;
    for (const href of findAnchorHrefs(html)) {
        const index = indexByLink.get(href.value);
        if (index === undefined) continue;
        const quote = href.quote || '"';
        tracked +=
            html.slice(cursor, href.start) +
            `href=${quote}${escapeHtml(options.clickUrl(index))}${quote}`;
        cursor = href.end;
    }
    tracked += html.slice(cursor);

    return insertPixel(tracked, options.pixelUrl);
}

// Just before the last `</body>`, so the document stays well formed; appended
// when there is none (the HTML format lets an admin paste a fragment).
function insertPixel(html: string, pixelUrl: string): string {
    const pixel = `<img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;

    let closingBody: RegExpExecArray | undefined;
    for (const match of html.matchAll(/<\/body\s*>/gi)) closingBody = match;
    if (!closingBody) return html + pixel;

    return (
        html.slice(0, closingBody.index) + pixel + html.slice(closingBody.index)
    );
}
