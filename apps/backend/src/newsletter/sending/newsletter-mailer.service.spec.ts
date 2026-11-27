import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { NewsletterMailerService } from '@/newsletter/sending/newsletter-mailer.service';
import { readNewsletterSettings } from '@/newsletter/newsletter-settings';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const MAIN = {
    'email.smtp.host': 'smtp.main.test',
    'email.smtp.port': 465,
    'email.smtp.secure': true,
    'email.smtp.user': 'main-user',
    'email.smtp.pass': 'main-pass',
    'email.from.email': 'noreply@bitshala.org',
    'email.from.name': 'Bitshala',
};

function configService(values: Record<string, unknown>): ConfigService {
    return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('readNewsletterSettings', () => {
    it('falls back to the main SMTP and sender when the block is absent', () => {
        expect(readNewsletterSettings(configService(MAIN))).toEqual({
            smtp: {
                host: 'smtp.main.test',
                port: 465,
                secure: true,
                user: 'main-user',
                pass: 'main-pass',
            },
            dedicatedTransport: false,
            from: { email: 'noreply@bitshala.org', name: 'Bitshala' },
            replyTo: null,
            dailyLimit: 1500,
            ratePerMinute: 30,
            postalAddress: null,
        });
    });

    it('treats blank (null) YAML keys as absent', () => {
        const settings = readNewsletterSettings(
            configService({
                ...MAIN,
                'email.newsletter.smtp.host': null,
                'email.newsletter.smtp.user': '  ',
                'email.newsletter.from.email': null,
                'email.newsletter.replyTo': '',
                'email.newsletter.dailyLimit': null,
                'email.newsletter.ratePerMinute': null,
            }),
        );
        expect(settings.smtp.host).toBe('smtp.main.test');
        expect(settings.dedicatedTransport).toBe(false);
        expect(settings.from.email).toBe('noreply@bitshala.org');
        expect(settings.replyTo).toBeNull();
        expect(settings.dailyLimit).toBe(1500);
    });

    it('prefers the newsletter keys, one by one', () => {
        const settings = readNewsletterSettings(
            configService({
                ...MAIN,
                'email.newsletter.smtp.host': 'smtp.gmail.com',
                'email.newsletter.smtp.port': '587',
                'email.newsletter.smtp.secure': false,
                'email.newsletter.smtp.user': 'news@bitshala.org',
                'email.newsletter.smtp.pass': 'app-password',
                'email.newsletter.from.name': 'Bitshala Newsletter',
                'email.newsletter.replyTo': 'hello@bitshala.org',
                'email.newsletter.dailyLimit': 1800,
                'email.newsletter.ratePerMinute': '20',
                'email.newsletter.postalAddress': 'Bengaluru, India',
            }),
        );
        expect(settings).toMatchObject({
            smtp: {
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                user: 'news@bitshala.org',
                pass: 'app-password',
            },
            dedicatedTransport: true,
            // Only the name is overridden; the address falls back.
            from: {
                email: 'noreply@bitshala.org',
                name: 'Bitshala Newsletter',
            },
            replyTo: 'hello@bitshala.org',
            dailyLimit: 1800,
            ratePerMinute: 20,
            postalAddress: 'Bengaluru, India',
        });
    });

    it('ignores nonsense limits', () => {
        const settings = readNewsletterSettings(
            configService({
                'email.newsletter.dailyLimit': 0,
                'email.newsletter.ratePerMinute': 'fast',
            }),
        );
        expect(settings.dailyLimit).toBe(1500);
        expect(settings.ratePerMinute).toBe(30);
    });

    it('never throws on an empty config', () => {
        expect(() => readNewsletterSettings(configService({}))).not.toThrow();
    });
});

describe('NewsletterMailerService', () => {
    const transport = { sendMail: jest.fn(), close: jest.fn() };

    beforeEach(() => {
        jest.clearAllMocks();
        (createTransport as jest.Mock).mockReturnValue(transport);
        transport.sendMail.mockResolvedValue({});
    });

    const mail = {
        to: 'alice@example.com',
        toName: 'Alice',
        subject: 'Hi',
        html: '<p>Hi</p>',
        text: 'Hi',
        headers: { Precedence: 'bulk' },
    };

    it('does not touch the network at construction', () => {
        new NewsletterMailerService(configService(MAIN));
        expect(createTransport).not.toHaveBeenCalled();
    });

    it('creates one pooled transport on first send and reuses it', async () => {
        const mailer = new NewsletterMailerService(
            configService({
                ...MAIN,
                'email.newsletter.smtp.user': 'news@bitshala.org',
                'email.newsletter.smtp.pass': 'app-password',
            }),
        );

        await mailer.send(mail);
        await mailer.send(mail);

        expect(createTransport).toHaveBeenCalledTimes(1);
        expect(createTransport).toHaveBeenCalledWith(
            expect.objectContaining({
                pool: true,
                host: 'smtp.main.test',
                port: 465,
                secure: true,
                auth: { user: 'news@bitshala.org', pass: 'app-password' },
                tls: { rejectUnauthorized: expect.any(Boolean) },
            }),
        );
        expect(transport.sendMail).toHaveBeenCalledWith({
            from: { name: 'Bitshala', address: 'noreply@bitshala.org' },
            to: { name: 'Alice', address: 'alice@example.com' },
            replyTo: undefined,
            subject: 'Hi',
            html: '<p>Hi</p>',
            text: 'Hi',
            headers: { Precedence: 'bulk' },
        });
        expect(mailer.usesDedicatedTransport()).toBe(true);
    });

    it('takes Reply-To from the newsletter, then the config, else none', async () => {
        const mailer = new NewsletterMailerService(
            configService({
                ...MAIN,
                'email.newsletter.replyTo': 'hello@bitshala.org',
            }),
        );

        await mailer.send({ ...mail, replyTo: 'editor@bitshala.org' });
        await mailer.send({ ...mail, replyTo: null });

        expect(transport.sendMail.mock.calls[0][0].replyTo).toBe(
            'editor@bitshala.org',
        );
        expect(transport.sendMail.mock.calls[1][0].replyTo).toBe(
            'hello@bitshala.org',
        );
        expect(mailer.getDefaultReplyTo()).toBe('hello@bitshala.org');
    });

    it('rejects with the transport error untouched', async () => {
        const error = Object.assign(new Error('Message failed'), {
            responseCode: 550,
            response: '550 5.4.5 Daily user sending limit exceeded.',
        });
        transport.sendMail.mockRejectedValue(error);
        const mailer = new NewsletterMailerService(configService(MAIN));

        await expect(mailer.send(mail)).rejects.toBe(error);
    });

    it('closes the transport on shutdown, if one was ever opened', async () => {
        const mailer = new NewsletterMailerService(configService(MAIN));
        mailer.onApplicationShutdown();
        expect(transport.close).not.toHaveBeenCalled();

        await mailer.send(mail);
        mailer.onApplicationShutdown();
        expect(transport.close).toHaveBeenCalledTimes(1);
    });
});
