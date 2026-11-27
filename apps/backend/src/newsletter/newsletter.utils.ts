import { randomBytes } from 'crypto';
import { isEmail } from 'class-validator';
import {
    EMAIL_MAX_LENGTH,
    MAILING_LIST_SLUG_MAX_LENGTH,
} from '@/newsletter/newsletter.constants';

/**
 * The one form an address is stored and compared in. Lowercasing the local
 * part is technically lossy, but no real provider distinguishes case there,
 * and treating `Alice@x` and `alice@x` as two subscribers is the worse bug.
 */
export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

/**
 * The same check `@IsEmail()` applies to request bodies, so an address that
 * passes DTO validation passes here too. Expects a normalized address.
 */
export function isValidEmail(email: string): boolean {
    return email.length <= EMAIL_MAX_LENGTH && isEmail(email);
}

/** 256 random bits, URL-safe (43 characters). */
export function generateSubscriberToken(): string {
    return randomBytes(32).toString('base64url');
}

/**
 * Lowercase ASCII words joined by hyphens, accents folded ("Café Club" ->
 * "cafe-club"). Empty when nothing alphanumeric survives; callers pick a
 * fallback.
 */
export function slugify(input: string): string {
    return input
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, MAILING_LIST_SLUG_MAX_LENGTH)
        .replace(/^-+|-+$/g, '');
}

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/** Safe in element content and in quoted attribute values. */
export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}
