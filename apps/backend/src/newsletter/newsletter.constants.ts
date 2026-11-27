// Fallbacks for `email.newsletter.*`, which existing deployments do not have.
// 1,500 stays under Google Workspace's 2,000 messages/day per user with room
// left for test sends.
export const NEWSLETTER_DEFAULT_DAILY_LIMIT = 1500;
export const NEWSLETTER_DEFAULT_RATE_PER_MINUTE = 30;

// Deliveries claimed per SEND_NEWSLETTER run. Small, so a run finishes well
// inside the stall-recovery window at the default pace.
export const NEWSLETTER_SEND_BATCH_SIZE = 25;

// A delivery that fails this many times for a non-quota reason is FAILED.
export const NEWSLETTER_MAX_SEND_ATTEMPTS = 3;

// How long sending pauses after the provider throttles or reports its quota.
export const NEWSLETTER_THROTTLE_PAUSE_MS = 60 * 60 * 1000;

// A SENDING delivery claimed longer ago than this belongs to a worker that
// died mid-batch, and is put back to PENDING.
export const NEWSLETTER_STALE_CLAIM_MS = 15 * 60 * 1000;

// A SENDING (or due SCHEDULED) newsletter with no progress for this long is
// re-queued: the task poller never re-runs a task stuck in PROCESSING.
export const NEWSLETTER_STALL_THRESHOLD_MS = 10 * 60 * 1000;

// At most one confirmation or preferences-link email per address per window,
// so neither the public form nor the profile page can flood someone's inbox.
export const NEWSLETTER_CONFIRMATION_RESEND_WINDOW_MS = 10 * 60 * 1000;

// Addresses sent a confirmation or preferences link in any rolling 24h. Both
// go through the main SMTP account, so a flood of fresh addresses on the
// public form must not use up the quota every other transactional email needs.
export const NEWSLETTER_CONFIRMATION_DAILY_CAP = 500;

// Hitting the cap alerts Discord at most this often (it is logged every time).
export const NEWSLETTER_CONFIRMATION_CAP_ALERT_INTERVAL_MS = 60 * 60 * 1000;

export const NEWSLETTER_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
// Recently served image bytes kept in memory, per app instance: every
// recipient's mail client fetches the same few images.
export const NEWSLETTER_IMAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
export const NEWSLETTER_IMAGE_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
];

export const NEWSLETTER_MAX_TEST_RECIPIENTS = 10;
export const NEWSLETTER_MAX_IMPORT_SUBSCRIBERS = 5000;

export const NEWSLETTER_DEFAULT_SUBJECT = 'Untitled newsletter';

// Stands in for a subscriber token in previews and test sends, so their
// unsubscribe and preferences links lead nowhere.
export const NEWSLETTER_PREVIEW_TOKEN = 'preview';

// Returned by every public subscribe request, known address or not, so the
// form cannot be used to find out who is subscribed.
export const NEWSLETTER_SUBSCRIBE_MESSAGE =
    'Thanks! If that address is new to these lists, a confirmation email is on its way.';

// Returned by every preferences-link request, whether an email went out or
// the resend window or daily cap held it back.
export const NEWSLETTER_PREFERENCES_LINK_MESSAGE =
    "We're emailing you a link to manage your newsletters. If you asked in the last few minutes, use the one we already sent.";

// Column lengths, for DTO validation to match the schema.
export const MAILING_LIST_NAME_MAX_LENGTH = 120;
export const MAILING_LIST_SLUG_MAX_LENGTH = 140;
export const SUBSCRIBER_NAME_MAX_LENGTH = 255;
export const NEWSLETTER_SUBJECT_MAX_LENGTH = 255;
export const NEWSLETTER_PREHEADER_MAX_LENGTH = 255;
export const EMAIL_MAX_LENGTH = 320;
