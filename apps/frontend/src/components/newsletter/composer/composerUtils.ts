import type {
  NewsletterDetailResponse,
  UpdateNewsletterRequest,
} from '@nonce/shared';
import {
  isValidEmail,
  normalizeEmail,
  parseEmailList,
} from '../shared/newsletterUtils';

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

// ---- audience ----

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
