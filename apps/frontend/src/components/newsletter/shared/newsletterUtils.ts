import {
  PortalAudience,
  SubscriberStatus,
  SubscriptionSource,
  SubscriptionStatus,
} from '@nonce/shared';
import {
  extractErrorMessage,
  isAxiosError,
  isThrottledError,
} from '../../../utils/errorUtils';

// Mirrors the column lengths the API validates against.
export const EMAIL_MAX_LENGTH = 320;
export const MAILING_LIST_NAME_MAX_LENGTH = 120;
export const MAILING_LIST_SLUG_MAX_LENGTH = 140;
export const MAILING_LIST_DESCRIPTION_MAX_LENGTH = 500;

/** The token the API puts in the links of test and preview emails. */
export const PREVIEW_TOKEN = 'preview';

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  [SubscriptionStatus.PENDING]: 'Pending',
  [SubscriptionStatus.SUBSCRIBED]: 'Subscribed',
  [SubscriptionStatus.UNSUBSCRIBED]: 'Unsubscribed',
};

export const SUBSCRIBER_STATUS_LABELS: Record<SubscriberStatus, string> = {
  [SubscriberStatus.ACTIVE]: 'Active',
  [SubscriberStatus.UNSUBSCRIBED]: 'Unsubscribed',
  [SubscriberStatus.BOUNCED]: 'Bounced',
};

export const SUBSCRIPTION_SOURCE_LABELS: Record<SubscriptionSource, string> = {
  [SubscriptionSource.PUBLIC_FORM]: 'Sign-up form',
  [SubscriptionSource.PROFILE]: 'Profile',
  [SubscriptionSource.ADMIN]: 'Added by admin',
  [SubscriptionSource.PORTAL_USERS]: 'Portal users',
};

export const PORTAL_AUDIENCE_LABELS: Record<PortalAudience, string> = {
  [PortalAudience.ALL_USERS]: 'All portal users',
  [PortalAudience.COHORT_MEMBERS]: 'Members of one cohort',
  [PortalAudience.COHORT_TYPE_MEMBERS]: 'Members of any cohort of a course',
  [PortalAudience.WAITLIST]: 'People on a waitlist',
  [PortalAudience.FELLOWS]: 'Fellows',
};

/**
 * Lowercase words joined by hyphens, accents folded ("Café Club" ->
 * "cafe-club"). Only a suggestion for the slug field: the API derives and
 * validates the real one.
 */
export const slugify = (input: string): string =>
  input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAILING_LIST_SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');

export const isValidSlug = (slug: string): boolean =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);

/** Saves a Blob the way a link click would; the API cannot be linked to. */
export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same tick can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---- errors ----

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

/**
 * For the pages a reader reaches from an email. Visitors share IPs, so a 429
 * is often someone else's burst: it asks them to wait instead of showing the
 * API's wording.
 */
export const throttleAwareErrorMessage = (error: unknown): string =>
  isThrottledError(error)
    ? 'Too many requests right now. Wait a moment and try again.'
    : extractErrorMessage(error);

// ---- email addresses ----

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

// ---- status and wording ----

export const isPausedNow = (pausedUntil: string | null): boolean =>
  !!pausedUntil && new Date(pausedUntil).getTime() > Date.now();

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
