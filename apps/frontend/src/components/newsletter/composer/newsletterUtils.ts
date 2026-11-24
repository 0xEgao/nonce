import {
  type NewsletterDetailResponse,
  NewsletterStatus,
  type UpdateNewsletterRequest,
} from '@nonce/shared';
import { extractErrorMessage, isAxiosError } from '../../../utils/errorUtils';

/**
 * extractErrorMessage, plus the ValidationPipe shape: a 400 from a DTO check
 * carries `message` as an array of strings, one per failed constraint.
 */
export const apiErrorMessage = (error: unknown): string => {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown } | undefined;
    if (Array.isArray(data?.message)) return data.message.join('. ');
  }
  return extractErrorMessage(error);
};

export const EMAIL_MAX_LENGTH = 320;
export const SUBJECT_MAX_LENGTH = 255;
export const PREHEADER_MAX_LENGTH = 255;
export const MAX_TEST_RECIPIENTS = 10;
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

// Close to what the API's @IsEmail() accepts (validator.js defaults): dotted
// atoms before the @, hyphenated labels after it, an alphabetic TLD. The
// server stays the authority; this only catches typos before a round trip.
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i;

/** The form the API stores and compares addresses in. */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

export const isValidEmail = (email: string): boolean =>
  email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email);

export interface ParsedEmailList {
  /** Normalized, deduplicated, well-formed. */
  valid: string[];
  /** Normalized, deduplicated, malformed. */
  invalid: string[];
}

/**
 * Splits pasted text on commas, semicolons and whitespace. Angle brackets and
 * quotes around an address are dropped, so a copied `<a@b.co>` still counts.
 */
export const parseEmailList = (text: string): ParsedEmailList => {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const email = normalizeEmail(raw.replace(/^[<"'(]+|[>"')]+$/g, ''));
    if (!email || seen.has(email)) continue;
    seen.add(email);
    (isValidEmail(email) ? valid : invalid).push(email);
  }
  return { valid, invalid };
};

// ---- merge tags ----

export interface MergeTag {
  tag: string;
  label: string;
  description: string;
  /** URL tags go in as a link with this text rather than as bare text. */
  linkText?: string;
}

export const MERGE_TAGS: MergeTag[] = [
  {
    tag: '{{name}}',
    label: 'Name',
    description: 'Full name, or "there" when unknown',
  },
  { tag: '{{first_name}}', label: 'First name', description: 'First name' },
  { tag: '{{email}}', label: 'Email', description: "Recipient's address" },
  {
    tag: '{{unsubscribe_url}}',
    label: 'Unsubscribe link',
    description: 'Without it, the standard footer is added',
    linkText: 'Unsubscribe',
  },
  {
    tag: '{{preferences_url}}',
    label: 'Preferences link',
    description: 'Lets the reader pick their lists',
    linkText: 'Manage preferences',
  },
];

// ---- draft fields <-> PATCH body ----

export interface DraftFields {
  subject: string;
  preheader: string;
  replyTo: string;
  trackingEnabled: boolean;
  contentFormat: NewsletterDetailResponse['contentFormat'];
  content: string;
  listIds: string[];
  adHocText: string;
}

export const draftFieldsFrom = (
  newsletter: NewsletterDetailResponse
): DraftFields => ({
  subject: newsletter.subject,
  preheader: newsletter.preheader ?? '',
  replyTo: newsletter.replyTo ?? '',
  trackingEnabled: newsletter.trackingEnabled,
  contentFormat: newsletter.contentFormat,
  content: newsletter.content,
  listIds: newsletter.listIds,
  adHocText: newsletter.adHocEmails.join('\n'),
});

/**
 * What autosave would store for these fields. A blank subject and a malformed
 * reply-to are left out rather than sent, so a half-typed value never turns
 * every save into a 400; malformed ad-hoc addresses are flagged in the form and
 * never saved.
 */
export const toUpdateBody = (fields: DraftFields): UpdateNewsletterRequest => {
  const body: UpdateNewsletterRequest = {
    preheader: fields.preheader.trim() || null,
    trackingEnabled: fields.trackingEnabled,
    contentFormat: fields.contentFormat,
    content: fields.content,
    listIds: fields.listIds,
    adHocEmails: parseEmailList(fields.adHocText).valid,
  };
  const subject = fields.subject.trim();
  if (subject) body.subject = subject;
  const replyTo = fields.replyTo.trim();
  if (!replyTo) body.replyTo = null;
  else if (isValidEmail(normalizeEmail(replyTo))) body.replyTo = replyTo;
  return body;
};

/** The fields of `next` that differ from `saved`, or null when none do. */
export const diffUpdateBody = (
  saved: UpdateNewsletterRequest,
  next: UpdateNewsletterRequest
): UpdateNewsletterRequest | null => {
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof UpdateNewsletterRequest)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(saved[key])) {
      diff[key] = next[key];
    }
  }
  return Object.keys(diff).length > 0
    ? (diff as UpdateNewsletterRequest)
    : null;
};

// ---- status ----

export const NEWSLETTER_STATUS_LABELS: Record<NewsletterStatus, string> = {
  [NewsletterStatus.DRAFT]: 'Draft',
  [NewsletterStatus.SCHEDULED]: 'Scheduled',
  [NewsletterStatus.SENDING]: 'Sending',
  [NewsletterStatus.SENT]: 'Sent',
  [NewsletterStatus.CANCELLED]: 'Cancelled',
};

export const isPausedNow = (pausedUntil: string | null): boolean =>
  !!pausedUntil && new Date(pausedUntil).getTime() > Date.now();

/** "Weekly digest, Fellows + 3 addresses" */
export const describeAudience = (
  listNames: string[],
  adHocCount: number
): string => {
  const parts = [...listNames];
  if (adHocCount > 0) {
    parts.push(`${adHocCount} address${adHocCount === 1 ? '' : 'es'}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'No audience yet';
};

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
