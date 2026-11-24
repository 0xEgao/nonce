/**
 * How the send loop treats a failed send:
 * - `throttled`: the account or server will not send right now (quota,
 *   rate limit, login, connection, refused sender). Nothing to do with the
 *   recipient, so the batch goes back to PENDING without spending attempts
 *   and the whole newsletter pauses.
 * - `bounced`: the recipient address is permanently undeliverable.
 * - `failed`: anything else; retried up to the attempt limit.
 */
export type SmtpErrorKind = 'throttled' | 'bounced' | 'failed';

type ThrottleCause = 'auth' | 'connection' | 'quota' | 'sender';

interface Classification {
    kind: SmtpErrorKind;
    cause?: ThrottleCause;
}

interface ParsedSmtpError {
    code: string | null;
    command: string | null;
    responseCode: number | null;
    /** RFC 3463 enhanced status code, e.g. [5, 1, 1]. */
    enhanced: [number, number, number] | null;
    text: string;
}

const AUTH_CODES = new Set(['EAUTH', 'ENOAUTH', 'EOAUTH2']);
const AUTH_RESPONSE_CODES = new Set([530, 534, 535]);
const CONNECTION_CODES = new Set([
    'ECONNECTION',
    'ETIMEDOUT',
    'ESOCKET',
    'EDNS',
    'ETLS',
    'EPROXY',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
]);
const THROTTLE_RESPONSE_CODES = new Set([421, 450, 451, 452, 454]);
const QUOTA_PATTERN =
    /daily|quota|rate limit|sending limit|too many|try again later/i;
// Only used when the server gave no enhanced status code.
const UNKNOWN_RECIPIENT_PATTERN =
    /user unknown|unknown user|no such user|does(?: not|n't) exist|recipient (?:address )?rejected|invalid recipient|recipient not found|mailbox not found/i;
// X.1.y codes about the destination mailbox. X.1.7 / X.1.8 are about the
// sender, and must never suppress a recipient.
const BAD_DESTINATION_DETAILS = new Set([1, 2, 3, 6, 10]);

export function classifySmtpError(error: unknown): SmtpErrorKind {
    return classify(parseSmtpError(error)).kind;
}

/** A one-line, human-readable account of the failure, for `error` columns. */
export function describeSmtpError(error: unknown): string {
    const parsed = parseSmtpError(error);
    const description =
        parsed.code && !parsed.responseCode
            ? `${parsed.code}: ${parsed.text}`
            : parsed.text;
    return truncate(description || 'Unknown error', 500);
}

/** Why the newsletter paused, for `pauseReason`. */
export function describeThrottle(error: unknown): string {
    const parsed = parseSmtpError(error);
    const detail = truncate(describeSmtpError(error), 300);
    switch (classify(parsed).cause) {
        case 'auth':
            return `The mail server rejected the newsletter SMTP login (${detail}). Check the email.newsletter.smtp settings; sending retries automatically.`;
        case 'connection':
            return `Could not reach the mail server (${detail}). Sending retries automatically.`;
        case 'sender':
            return `The mail server refused the sender address (${detail}). Check the newsletter From address; sending retries automatically.`;
        default:
            return `The mail provider is throttling sends or the daily sending quota is used up (${detail}). Sending resumes automatically.`;
    }
}

function classify(error: ParsedSmtpError): Classification {
    const { code, command, responseCode, enhanced, text } = error;

    if (
        (code && AUTH_CODES.has(code)) ||
        (responseCode && AUTH_RESPONSE_CODES.has(responseCode))
    ) {
        return { kind: 'throttled', cause: 'auth' };
    }
    if (!responseCode && code && CONNECTION_CODES.has(code)) {
        return { kind: 'throttled', cause: 'connection' };
    }

    // Answers about the recipient's mailbox come before the generic 4xx and
    // quota rules: "452 4.2.2 over quota" is the recipient's full inbox, not
    // ours, and pausing everything for it would stall on that one address.
    const aboutRecipient = command === null || command.startsWith('RCPT');
    if (enhanced && aboutRecipient) {
        const [status, subject, detail] = enhanced;
        if (subject === 1) {
            if (status === 5 && BAD_DESTINATION_DETAILS.has(detail)) {
                return { kind: 'bounced' };
            }
            if (detail !== 7 && detail !== 8) return { kind: 'failed' };
        }
        if (subject === 2) {
            // 5.2.1: mailbox disabled. Full or over-size mailboxes may recover.
            return {
                kind: status === 5 && detail === 1 ? 'bounced' : 'failed',
            };
        }
    }
    if (
        !enhanced &&
        aboutRecipient &&
        responseCode &&
        responseCode >= 550 &&
        (responseCode === 551 || UNKNOWN_RECIPIENT_PATTERN.test(text))
    ) {
        return { kind: 'bounced' };
    }

    if (
        (enhanced && enhanced[1] === 4 && enhanced[2] === 5) ||
        (responseCode && THROTTLE_RESPONSE_CODES.has(responseCode)) ||
        QUOTA_PATTERN.test(text)
    ) {
        return { kind: 'throttled', cause: 'quota' };
    }
    if (responseCode && responseCode >= 500 && command?.startsWith('MAIL')) {
        return { kind: 'throttled', cause: 'sender' };
    }
    return { kind: 'failed' };
}

function parseSmtpError(error: unknown): ParsedSmtpError {
    const fields =
        typeof error === 'object' && error !== null
            ? (error as Record<string, unknown>)
            : {};
    const response =
        typeof fields.response === 'string' ? fields.response.trim() : '';
    const message =
        typeof fields.message === 'string'
            ? fields.message
            : typeof error === 'string'
              ? error
              : '';
    const responseCode =
        typeof fields.responseCode === 'number'
            ? fields.responseCode
            : Number(/^(\d{3})[ -]/.exec(response)?.[1]) || null;
    const enhancedMatch = /^\d{3}[ -]([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(
        response,
    );

    return {
        code: typeof fields.code === 'string' ? fields.code : null,
        command:
            typeof fields.command === 'string'
                ? fields.command.toUpperCase()
                : null,
        responseCode,
        enhanced: enhancedMatch
            ? [
                  Number(enhancedMatch[1]),
                  Number(enhancedMatch[2]),
                  Number(enhancedMatch[3]),
              ]
            : null,
        text: response ? joinResponseLines(response) : message.trim(),
    };
}

// Multi-line replies repeat the codes on every line ("550-5.1.1 ...\n550-5.1.1
// ...\n550 5.1.1 ..."); keep them once.
function joinResponseLines(response: string): string {
    const [first, ...rest] = response.split(/\r?\n/);
    const continuation = rest.map((line) =>
        line.replace(/^\d{3}[ -](?:\d\.\d{1,3}\.\d{1,3}\s+)?/, ''),
    );
    return [first.replace(/^(\d{3})-/, '$1 '), ...continuation]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
