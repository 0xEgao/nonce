import { ConfigService } from '@nestjs/config';
import {
    NEWSLETTER_DEFAULT_DAILY_LIMIT,
    NEWSLETTER_DEFAULT_RATE_PER_MINUTE,
} from '@/newsletter/newsletter.constants';

export interface NewsletterSmtpSettings {
    host: string;
    port: number;
    secure: boolean;
    user: string | null;
    pass: string | null;
}

export interface NewsletterSettings {
    smtp: NewsletterSmtpSettings;
    /** A newsletter-specific SMTP user is configured. */
    dedicatedTransport: boolean;
    from: { email: string; name: string };
    replyTo: string | null;
    dailyLimit: number;
    ratePerMinute: number;
    postalAddress: string | null;
}

/**
 * `email.newsletter.*`, falling back key by key to the transactional
 * `email.smtp.*` / `email.from.*`. Never throws: deployments that predate
 * newsletters have no `email.newsletter` block at all, and blank YAML keys
 * arrive as null.
 */
export function readNewsletterSettings(
    configService: ConfigService,
): NewsletterSettings {
    const read = (key: string): unknown => configService.get<unknown>(key);

    const newsletterUser = text(read('email.newsletter.smtp.user'));
    const port =
        positiveInt(read('email.newsletter.smtp.port')) ??
        positiveInt(read('email.smtp.port'));
    const secure =
        bool(read('email.newsletter.smtp.secure')) ??
        bool(read('email.smtp.secure')) ??
        port === 465;

    return {
        smtp: {
            host:
                text(read('email.newsletter.smtp.host')) ??
                text(read('email.smtp.host')) ??
                'localhost',
            port: port ?? (secure ? 465 : 587),
            secure,
            user: newsletterUser ?? text(read('email.smtp.user')),
            pass:
                text(read('email.newsletter.smtp.pass')) ??
                text(read('email.smtp.pass')),
        },
        dedicatedTransport: newsletterUser !== null,
        from: {
            email:
                text(read('email.newsletter.from.email')) ??
                text(read('email.from.email')) ??
                'noreply@bitshala.org',
            name:
                text(read('email.newsletter.from.name')) ??
                text(read('email.from.name')) ??
                'Bitshala',
        },
        replyTo: text(read('email.newsletter.replyTo')),
        dailyLimit:
            positiveInt(read('email.newsletter.dailyLimit')) ??
            NEWSLETTER_DEFAULT_DAILY_LIMIT,
        ratePerMinute:
            positiveInt(read('email.newsletter.ratePerMinute')) ??
            NEWSLETTER_DEFAULT_RATE_PER_MINUTE,
        postalAddress: text(read('email.newsletter.postalAddress')),
    };
}

function text(value: unknown): string | null {
    if (typeof value === 'number') return String(value);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

// Env overrides arrive JSON-parsed, but a quoted value can still be a string.
function positiveInt(value: unknown): number | null {
    const parsed =
        typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : value;
    return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0
        ? parsed
        : null;
}

function bool(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return null;
}
