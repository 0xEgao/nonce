import { join } from 'path';
import { Eta } from 'eta';
import { MailTemplate } from '@/mail/mail.enum';

// same options as MailService; the Eta types are not usable here either
const eta: any = new (Eta as any)({
    views: join(__dirname, '..', '..', 'assets', 'mail-templates'),
});

// Every template is dark by design. Clients with forced dark mode re-transform
// emails that don't declare a color scheme, so each one must declare dark-only
// and carry bgcolor attributes next to its inline backgrounds.
describe('mail templates — dark scheme declaration', () => {
    // templates only interpolate `it.<field>`, so any string will do
    const context = new Proxy({}, { get: () => 'x' });

    it.each(Object.values(MailTemplate))('%s', (template) => {
        const html: string = eta.render(`${template}.html.eta`, context);

        expect(html).toContain('<meta name="color-scheme" content="dark" />');
        expect(html).toContain(
            '<meta name="supported-color-schemes" content="dark" />',
        );
        expect(html).toContain('color-scheme: dark');

        const tagsMissingBgcolor = (
            html.match(/<(?:body|table|td|th)\b[^>]*>/g) ?? ([] as string[])
        ).filter(
            (tag) =>
                tag.includes('background-color:') && !tag.includes('bgcolor='),
        );
        expect(tagsMissingBgcolor).toEqual([]);
    });
});

// These go to addresses nobody has proven they own (typed into the public
// form, or onto a portal account), so they must carry no name and nothing else
// a stranger could choose, only the link.
describe('mail templates — newsletter transactional emails', () => {
    const cases: [MailTemplate, string[]][] = [
        [
            MailTemplate.NewsletterSubscriptionConfirmation,
            ['confirmUrl', 'listNames'],
        ],
        [MailTemplate.NewsletterPreferencesLink, ['preferencesUrl']],
    ];

    it.each(cases)('%s reads only %j', (template, fields) => {
        const read = new Set<string>();
        const context = new Proxy(
            {},
            {
                get: (_, key) => {
                    if (typeof key === 'string') read.add(key);
                    return `value-of-${String(key)}`;
                },
            },
        );

        const html: string = eta.render(`${template}.html.eta`, context);
        const text: string = eta.render(`${template}.text.eta`, context);

        expect([...read].sort()).toEqual(fields);
        for (const field of fields) {
            expect(html).toContain(`value-of-${field}`);
            expect(text).toContain(`value-of-${field}`);
        }
    });
});
