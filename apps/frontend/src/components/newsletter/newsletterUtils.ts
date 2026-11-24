import {
  PortalAudience,
  SubscriberStatus,
  SubscriptionSource,
  SubscriptionStatus,
} from '@nonce/shared';

// Mirrors the column lengths the API validates against.
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
    .replace(/[\u0300-\u036f]/g, '')
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
