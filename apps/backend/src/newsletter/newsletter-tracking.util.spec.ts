import {
    applyTracking,
    extractTrackableLinks,
    isHttpUrl,
} from '@/newsletter/newsletter-tracking.util';

const PIXEL = 'https://api.example.com/newsletter/public/t/o/d-1.gif';
const clickUrl = (index: number) =>
    `https://api.example.com/newsletter/public/t/c/d-1/${index}`;

const track = (html: string, links: string[]) =>
    applyTracking(html, { links, clickUrl, pixelUrl: PIXEL });

// What the pixel looks like in the output, for the placement assertions.
const pixelTag = (html: string) =>
    /<img src="[^"]*\.gif"[^>]*>/.exec(html)?.[0];

describe('extractTrackableLinks', () => {
    it('returns absolute http and https links in order of first appearance', () => {
        const html = `
            <p><a href="https://b.example/second">b</a></p>
            <p><a href="http://a.example/first">a</a></p>
        `;
        expect(extractTrackableLinks(html)).toEqual([
            'https://b.example/second',
            'http://a.example/first',
        ]);
    });

    it('lists a link used several times once', () => {
        const html = `
            <a href="https://x.example/">1</a>
            <a href="https://y.example/">2</a>
            <a href='https://x.example/'>3</a>
            <a href="https://x.example/&#x3F;">4</a>
        `;
        expect(extractTrackableLinks(html)).toEqual([
            'https://x.example/',
            'https://y.example/',
            'https://x.example/?',
        ]);
    });

    it('reads double-quoted, single-quoted and unquoted values', () => {
        const html = `
            <a href="https://d.example/">d</a>
            <a href='https://s.example/'>s</a>
            <a href=https://u.example/path?a=1&b=2>u</a>
        `;
        expect(extractTrackableLinks(html)).toEqual([
            'https://d.example/',
            'https://s.example/',
            'https://u.example/path?a=1&b=2',
        ]);
    });

    it('finds href whatever its position among the attributes', () => {
        const html = `
            <a class="btn" style="color:red" href="https://first.example/" target="_blank">1</a>
            <a data-x='1' title="a > b" href="https://second.example/">2</a>
            <a href="https://third.example/" rel="noopener">3</a>
        `;
        expect(extractTrackableLinks(html)).toEqual([
            'https://first.example/',
            'https://second.example/',
            'https://third.example/',
        ]);
    });

    it('handles uppercase tags and attributes and newlines inside the tag', () => {
        const html = `<A\n  CLASS="x"\n  HREF = "https://upper.example/"\n>up</A>`;
        expect(extractTrackableLinks(html)).toEqual(['https://upper.example/']);
    });

    it('decodes named and numeric entities in the value', () => {
        const html = `
            <a href="https://e.example/?a=1&amp;b=2&#38;c=3&#x26;d=4">1</a>
            <a href="https://e.example/?q=&quot;x&quot;&lt;y&gt;&apos;">2</a>
        `;
        expect(extractTrackableLinks(html)).toEqual([
            'https://e.example/?a=1&b=2&c=3&d=4',
            `https://e.example/?q="x"<y>'`,
        ]);
    });

    it('decodes an entity once, and leaves malformed ones alone', () => {
        const html = `
            <a href="https://e.example/?a=&amp;lt;">1</a>
            <a href="https://e.example/?b=&#0;&#xD800;&#99999999;&unknown;">2</a>
            <a href="https://e.example/?c=1&copy=2">3</a>
        `;
        expect(extractTrackableLinks(html)).toEqual([
            'https://e.example/?a=&lt;',
            'https://e.example/?b=&#0;&#xD800;&#99999999;&unknown;',
            'https://e.example/?c=1&copy=2',
        ]);
    });

    it('trims whitespace around the value', () => {
        expect(
            extractTrackableLinks('<a href="  https://t.example/\n">t</a>'),
        ).toEqual(['https://t.example/']);
    });

    it('skips links that still contain a merge tag', () => {
        const html = `
            <a href="{{unsubscribe_url}}">Unsubscribe</a>
            <a href="{{ preferences_url }}">Preferences</a>
            <a href="https://x.example/?e={{email}}">personal</a>
            <a href="https://x.example/?e=%7B%7Bemail%7D%7D">kept</a>
            <a href="https://x.example/plain">plain</a>
        `;
        expect(extractTrackableLinks(html)).toEqual([
            'https://x.example/?e=%7B%7Bemail%7D%7D',
            'https://x.example/plain',
        ]);
    });

    it('skips an entity-encoded merge tag too', () => {
        expect(
            extractTrackableLinks(
                '<a href="https://x.example/?{&#123;name}}">x</a>',
            ),
        ).toEqual([]);
    });

    it('skips unsubscribe and preferences pages that were already resolved', () => {
        const html = `
            <a href="https://app.example/newsletter/unsubscribe?token=abc&n=1">u</a>
            <a href="https://app.example/newsletter/preferences?token=abc">p</a>
            <a href="https://api.example/newsletter/public/unsubscribe/one-click?token=abc">o</a>
            <a href="https://app.example/newsletter/subscribe">kept</a>
        `;
        expect(extractTrackableLinks(html)).toEqual([
            'https://app.example/newsletter/subscribe',
        ]);
    });

    it('skips non-http schemes, fragments, relative and empty links', () => {
        const html = `
            <a href="mailto:hello@example.com">mail</a>
            <a href="tel:+15551234567">call</a>
            <a href="#top">top</a>
            <a href="/relative/path">rel</a>
            <a href="//cdn.example/protocol-relative">proto</a>
            <a href="javascript:alert(1)">js</a>
            <a href="data:text/html,hi">data</a>
            <a href="ftp://files.example/x">ftp</a>
            <a href="https:no-slashes">odd</a>
            <a href="">empty</a>
            <a href>valueless</a>
            <a>no href</a>
        `;
        expect(extractTrackableLinks(html)).toEqual([]);
    });

    it('only looks at <a> tags', () => {
        const html = `
            <link rel="stylesheet" href="https://css.example/a.css">
            <area href="https://area.example/" shape="rect">
            <abbr title="x" href="https://abbr.example/">abbr</abbr>
            <article href="https://article.example/">x</article>
            <img src="https://img.example/a.png">
            <base href="https://base.example/">
            <a href="https://real.example/">real</a>
        `;
        expect(extractTrackableLinks(html)).toEqual(['https://real.example/']);
    });

    it('does not take an href that sits inside another attribute value', () => {
        const html = `<a title="see href='https://trap.example/'" href="https://real.example/">x</a>`;
        expect(extractTrackableLinks(html)).toEqual(['https://real.example/']);
    });

    it('uses the first href when a tag repeats it', () => {
        const html = `<a href="https://one.example/" href="https://two.example/">x</a>`;
        expect(extractTrackableLinks(html)).toEqual(['https://one.example/']);
    });

    it('returns nothing for html without links or for an empty string', () => {
        expect(extractTrackableLinks('')).toEqual([]);
        expect(extractTrackableLinks('<p>hi</p>')).toEqual([]);
    });

    it('ignores a tag with an unbalanced quote instead of failing', () => {
        const html = `<a href="https://broken.example/>x</a> <a href="https://ok.example/">ok</a>`;
        expect(extractTrackableLinks(html)).toEqual(['https://ok.example/']);
    });

    it('treats an <a inside a quoted value as part of the tag around it', () => {
        const html = `<a title='<a href="https://inner.example/">' href="https://outer.example/">x</a><a href="https://next.example/">y</a>`;
        expect(extractTrackableLinks(html)).toEqual([
            'https://outer.example/',
            'https://next.example/',
        ]);
    });

    it('finds an anchor inside the value of an unterminated one', () => {
        // The first tag's `'` never closes, so it is no tag; the second is.
        const html = `<a title='x <a href="https://ok.example/">ok</a>`;
        expect(extractTrackableLinks(html)).toEqual(['https://ok.example/']);
    });

    it.each([
        ['<a ', '<a '.repeat(100_000)],
        ['<a "', '<a "'.repeat(75_000)],
        ['<a \'"', `<a '"`.repeat(60_000)],
        ['<a  followed by one quoted >', `${'<a '.repeat(100_000)}">`],
    ])('scans 300 KB of unterminated %s in linear time', (_label, html) => {
        const started = performance.now();
        extractTrackableLinks(html);
        track(html, ['https://a.example/']);
        expect(performance.now() - started).toBeLessThan(500);
    });
});

describe('applyTracking', () => {
    const links = ['https://a.example/', 'https://b.example/?x=1&y=2'];

    it('rewrites each listed link to its click url, by index', () => {
        const html =
            '<body><a href="https://b.example/?x=1&amp;y=2">b</a> <a href="https://a.example/">a</a></body>';
        const result = track(html, links);

        expect(result).toContain(`<a href="${clickUrl(1)}">b</a>`);
        expect(result).toContain(`<a href="${clickUrl(0)}">a</a>`);
        expect(result).not.toContain('a.example');
        expect(result).not.toContain('b.example');
    });

    it('rewrites every occurrence of a repeated link to the same index', () => {
        const html =
            '<a href="https://a.example/">1</a><a href="https://a.example/">2</a>';
        const result = track(html, links);

        expect(result.split(clickUrl(0))).toHaveLength(3);
    });

    it('keeps every other attribute, and its order, untouched', () => {
        const html =
            '<a class="btn" data-button="true" style="a:b; c:d" href="https://a.example/" target="_blank" rel="noopener">go</a>';
        expect(track(html, links)).toContain(
            `<a class="btn" data-button="true" style="a:b; c:d" href="${clickUrl(0)}" target="_blank" rel="noopener">go</a>`,
        );
    });

    it('keeps the quote style of the attribute it rewrites', () => {
        expect(track(`<a href='https://a.example/'>x</a>`, links)).toContain(
            `<a href='${clickUrl(0)}'>x</a>`,
        );
        expect(track('<a href=https://a.example/>x</a>', links)).toContain(
            `<a href="${clickUrl(0)}">x</a>`,
        );
    });

    it('handles uppercase tags and newlines inside the tag', () => {
        const html = `<A\n  CLASS="x"\n  HREF = "https://a.example/"\n>up</A>`;
        expect(track(html, links)).toContain(
            `<A\n  CLASS="x"\n  href="${clickUrl(0)}"\n>up</A>`,
        );
    });

    it('matches on the decoded value, so entity-encoded links are found', () => {
        const html = '<a href="https://b.example/?x=1&#38;y=2">b</a>';
        expect(track(html, links)).toContain(`href="${clickUrl(1)}"`);
    });

    it('leaves links that are not in the list alone', () => {
        const html = `
            <a href="https://other.example/">other</a>
            <a href="mailto:hi@example.com">mail</a>
            <a href="#top">top</a>
            <a href="https://a.example/">a</a>
        `;
        const result = track(html, links);

        expect(result).toContain('<a href="https://other.example/">other</a>');
        expect(result).toContain('<a href="mailto:hi@example.com">mail</a>');
        expect(result).toContain('<a href="#top">top</a>');
        expect(result).toContain(`<a href="${clickUrl(0)}">a</a>`);
    });

    it('leaves a link whose merge tag resolved to a per-recipient value alone', () => {
        // The template link `https://x.example/?e={{email}}` was never listed.
        const html = '<a href="https://x.example/?e=jane@example.com">x</a>';
        expect(track(html, links)).toContain(
            '<a href="https://x.example/?e=jane@example.com">x</a>',
        );
    });

    it('requires an exact match, not a prefix', () => {
        const html =
            '<a href="https://a.example/more">x</a><a href="https://a.example">y</a>';
        const result = track(html, links);

        expect(result).toContain('href="https://a.example/more"');
        expect(result).toContain('href="https://a.example"');
    });

    it('does not touch href on non-anchor tags', () => {
        const html = `
            <link rel="stylesheet" href="https://a.example/">
            <area href="https://a.example/" shape="rect">
            <base href="https://a.example/">
            <abbr href="https://a.example/">x</abbr>
        `;
        const result = track(html, links);

        expect(result.match(/href="https:\/\/a\.example\/"/g)).toHaveLength(4);
        expect(result).not.toContain(clickUrl(0));
    });

    it('does not rewrite an href hidden inside another attribute value', () => {
        const html = `<a title="href='https://a.example/'" href="https://b.example/?x=1&amp;y=2">x</a>`;
        const result = track(html, links);

        expect(result).toContain(`title="href='https://a.example/'"`);
        expect(result).toContain(`href="${clickUrl(1)}"`);
    });

    it('attribute-escapes the click url', () => {
        const result = applyTracking('<a href="https://a.example/">x</a>', {
            links,
            clickUrl: () => 'https://t.example/c?a=1&b="2"',
            pixelUrl: 'https://t.example/o?a=1&b=2',
        });

        expect(result).toContain(
            '<a href="https://t.example/c?a=1&amp;b=&quot;2&quot;">',
        );
        expect(result).toContain('src="https://t.example/o?a=1&amp;b=2"');
    });

    describe('open pixel', () => {
        it('goes immediately before </body>', () => {
            const result = track('<html><body><p>hi</p></body></html>', links);

            expect(result).toMatch(
                /^<html><body><p>hi<\/p><img src="[^"]+"[^>]*><\/body><\/html>$/,
            );
            expect(pixelTag(result)).toContain(`src="${PIXEL}"`);
        });

        it('finds </body> case-insensitively, even with whitespace', () => {
            const result = track('<BODY>hi</BODY >', links);

            expect(result).toMatch(/^<BODY>hi<img [^>]+><\/BODY >$/);
        });

        it('uses the last </body>', () => {
            const html = '<body>one<!-- </body> -->two</body>';
            const result = track(html, links);

            expect(result.indexOf('<img')).toBeGreaterThan(
                result.indexOf('two'),
            );
            expect(result.endsWith('</body>')).toBe(true);
            expect(result.match(/<img /g)).toHaveLength(1);
        });

        it('is appended when there is no </body>', () => {
            const result = track('<p>fragment</p>', links);

            expect(result.startsWith('<p>fragment</p><img ')).toBe(true);
            expect(result.endsWith('/>')).toBe(true);
            expect(result.match(/<img /g)).toHaveLength(1);
        });

        it('is still added to an empty document and when no link is listed', () => {
            expect(track('', [])).toMatch(/^<img src="[^"]+"[^>]*\/>$/);
            expect(track('<p>no links</p>', [])).toContain(`src="${PIXEL}"`);
        });

        it('is a 1x1 image with no alt text and no visible footprint', () => {
            const tag = pixelTag(track('<p>x</p>', links)) ?? '';

            expect(tag).toContain('width="1"');
            expect(tag).toContain('height="1"');
            expect(tag).toContain('alt=""');
            expect(tag).toContain('display:block');
        });
    });

    it('returns the html unchanged apart from the pixel when nothing matches', () => {
        const html = '<body><a href="https://nope.example/">x</a></body>';
        const result = track(html, links);

        expect(result.replace(/<img [^>]+>/, '')).toBe(html);
    });

    it('rewrites links across a realistic document', () => {
        const html = `<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="https://a.example/"><title>t</title></head>
<body style="margin:0">
  <table><tr><td>
    <a href="https://a.example/" style="color:#fff">A</a>
    <a href="{{unsubscribe_url}}">Unsubscribe</a>
    <a href="https://b.example/?x=1&amp;y=2">B</a>
  </td></tr></table>
</body>
</html>`;
        const result = track(html, extractTrackableLinks(html));

        expect(result).toContain(
            `<link rel="stylesheet" href="https://a.example/">`,
        );
        expect(result).toContain(
            `<a href="${clickUrl(0)}" style="color:#fff">A</a>`,
        );
        expect(result).toContain(
            '<a href="{{unsubscribe_url}}">Unsubscribe</a>',
        );
        expect(result).toContain(`<a href="${clickUrl(1)}">B</a>`);
        expect(result).toMatch(/<img [^>]+><\/body>\n<\/html>$/);
    });
});

describe('isHttpUrl', () => {
    it.each([
        'http://example.com',
        'https://example.com/path?q=1#frag',
        'HTTPS://EXAMPLE.COM',
        'https://user@example.com:8080/x',
    ])('accepts %s', (value) => {
        expect(isHttpUrl(value)).toBe(true);
    });

    it.each([
        '',
        'example.com',
        '/relative',
        '//example.com',
        'javascript:alert(1)',
        'data:text/html,x',
        'mailto:a@b.co',
        'ftp://example.com',
        'https:example.com',
        'https://',
        'https:// example.com',
        ' https://example.com',
    ])('rejects %j', (value) => {
        expect(isHttpUrl(value)).toBe(false);
    });

    it('rejects values that are not strings', () => {
        expect(isHttpUrl(null)).toBe(false);
        expect(isHttpUrl(undefined)).toBe(false);
        expect(isHttpUrl(42)).toBe(false);
        expect(isHttpUrl({ href: 'https://example.com' })).toBe(false);
    });
});
