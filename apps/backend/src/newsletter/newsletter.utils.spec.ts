import {
    escapeHtml,
    generateSubscriberToken,
    isValidEmail,
    normalizeEmail,
    slugify,
} from '@/newsletter/newsletter.utils';

describe('newsletter utils', () => {
    describe('normalizeEmail', () => {
        it('trims and lowercases', () => {
            expect(normalizeEmail('  Alice.Smith@Example.COM \n')).toBe(
                'alice.smith@example.com',
            );
        });
    });

    describe('isValidEmail', () => {
        it.each(['alice@example.com', 'a.b+news@sub.example.org'])(
            'accepts %s',
            (email) => {
                expect(isValidEmail(email)).toBe(true);
            },
        );

        it.each([
            '',
            'alice',
            'alice@',
            '@example.com',
            'alice@example',
            'alice @example.com',
            'alice@@example.com',
        ])('rejects %p', (email) => {
            expect(isValidEmail(email)).toBe(false);
        });

        it('rejects addresses longer than 320 characters', () => {
            const email = `${'a'.repeat(64)}@${'b'.repeat(250)}.example.com`;
            expect(email.length).toBeGreaterThan(320);
            expect(isValidEmail(email)).toBe(false);
        });
    });

    describe('generateSubscriberToken', () => {
        it('is URL-safe, fits the column and does not repeat', () => {
            const tokens = new Set(
                Array.from({ length: 50 }, () => generateSubscriberToken()),
            );
            expect(tokens.size).toBe(50);
            for (const token of tokens) {
                expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
            }
        });
    });

    describe('slugify', () => {
        it.each([
            ['Bitshala Weekly', 'bitshala-weekly'],
            ['  Café & Club: 2026!  ', 'cafe-club-2026'],
            ['--Already-a-slug--', 'already-a-slug'],
            ['Ünïcödé', 'unicode'],
        ])('%p -> %p', (input, expected) => {
            expect(slugify(input)).toBe(expected);
        });

        it('is empty when nothing alphanumeric survives', () => {
            expect(slugify('!!! ???')).toBe('');
        });

        it('caps the length without leaving a trailing hyphen', () => {
            const slug = slugify(`${'a'.repeat(139)} b`);
            expect(slug).toBe('a'.repeat(139));
        });
    });

    describe('escapeHtml', () => {
        it('escapes markup and both quote styles', () => {
            expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe(
                '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;',
            );
        });

        it('leaves plain text alone', () => {
            expect(escapeHtml('Hello there')).toBe('Hello there');
        });
    });
});
