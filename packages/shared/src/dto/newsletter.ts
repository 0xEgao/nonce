import {
  CohortType,
  NewsletterContentFormat,
  NewsletterDeliveryStatus,
  NewsletterStatus,
  PortalAudience,
  SubscriberStatus,
  SubscriptionSource,
  SubscriptionStatus,
} from '../enums';
import { PaginatedQuery } from './common';

// --- Public: subscribe, confirm, preferences, unsubscribe ------------------
// Every token below is the subscriber's opaque token, delivered by email. It
// is the only proof of owning the address, so it stands in for a session.

export interface PublicMailingListResponse {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export interface PublicSubscribeRequest {
  email: string;
  name?: string;
  /** Lists that are not public or are archived are silently dropped. */
  listSlugs: string[];
  /** Honeypot. Humans never see the field; anything in it means a bot. */
  website?: string;
}

/**
 * Always the same message, whether or not the address was already known, so
 * the form cannot be used to probe who is subscribed.
 */
export interface PublicSubscribeResponse {
  message: string;
}

export interface ConfirmSubscriptionRequest {
  token: string;
}

export interface ConfirmSubscriptionResponse {
  email: string;
  /** Names of the lists the confirmation subscribed the address to. */
  lists: string[];
}

export interface PublicPreferencesQuery {
  token: string;
}

export interface SubscriberPreferenceList {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Null when the address has never been on this list. */
  status: SubscriptionStatus | null;
}

export interface SubscriberPreferencesResponse {
  email: string;
  name: string | null;
  status: SubscriberStatus;
  /** Public, non-archived lists plus any list the address has a row on. */
  lists: SubscriberPreferenceList[];
}

export interface UpdatePreferencesRequest {
  /**
   * The full desired set among the lists shown. Every other shown list
   * becomes UNSUBSCRIBED.
   */
  subscribedListIds: string[];
  /** Unsubscribes from every list and suppresses the address globally. */
  unsubscribeAll?: boolean;
}

export interface PublicUpdatePreferencesRequest extends UpdatePreferencesRequest {
  token: string;
}

export interface UnsubscribeRequest {
  token: string;
  /** Unsubscribe from this newsletter's lists only. */
  newsletterId?: string;
  /** Unsubscribe from everything. Implied when `newsletterId` is absent. */
  all?: boolean;
}

export interface UnsubscribeResponse {
  email: string;
  /** Names of the lists the request unsubscribed the address from. */
  unsubscribedLists: string[];
  /** True when the address is now suppressed from every send. */
  global: boolean;
}

/** RFC 8058 one-click target, put in the List-Unsubscribe header. */
export interface OneClickUnsubscribeQuery {
  token: string;
  /** Newsletter id. */
  n?: string;
}

// --- Signed-in user ---------------------------------------------------------
// The account email is not verified, so a session alone never reads or changes
// an address's lists. It can only have that address mailed its preferences
// link (the token pages above).

/**
 * Always the same message, whether a link went out or the resend window or
 * daily cap held it back.
 */
export interface PreferencesLinkResponse {
  message: string;
}

// --- Admin: mailing lists ---------------------------------------------------

export interface ListMailingListsQuery {
  includeArchived?: boolean;
}

export interface MailingListResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** Shown on the public subscribe form and self-subscribable. */
  isPublic: boolean;
  archivedAt: string | null;
  /** SUBSCRIBED rows whose subscriber is ACTIVE: who a send would reach. */
  subscriberCount: number;
  pendingCount: number;
  unsubscribedCount: number;
  createdAt: string;
}

export interface CreateMailingListRequest {
  name: string;
  /** Derived from `name` when omitted. A clash is a 409. */
  slug?: string;
  description?: string;
  isPublic?: boolean;
}

export interface UpdateMailingListRequest {
  name?: string;
  /** Null clears it. */
  description?: string | null;
  isPublic?: boolean;
  /** True archives the list, false restores it. */
  archived?: boolean;
}

export interface ListMailingListSubscribersQuery extends PaginatedQuery {
  /** Matches email or name. */
  search?: string;
  status?: SubscriptionStatus;
}

/** One row of a list's subscriber table: the subscription joined to its address. */
export interface ListSubscriberResponse {
  subscriptionId: string;
  subscriberId: string;
  email: string;
  name: string | null;
  subscriptionStatus: SubscriptionStatus;
  subscriberStatus: SubscriberStatus;
  source: SubscriptionSource;
  createdAt: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
}

export interface AddSubscriberEntry {
  email: string;
  name?: string;
}

export interface AddSubscribersRequest {
  /** 1..5000 entries. */
  subscribers: AddSubscriberEntry[];
  /**
   * Re-subscribe addresses that unsubscribed from this list or are globally
   * suppressed. Without it they are counted and left alone.
   */
  resubscribe?: boolean;
}

export interface AddSubscribersResponse {
  added: number;
  alreadySubscribed: number;
  /** Had unsubscribed from this list; left alone without `resubscribe`. */
  skippedUnsubscribed: number;
  /** Globally UNSUBSCRIBED or BOUNCED; left alone without `resubscribe`. */
  skippedSuppressed: number;
  /** Malformed addresses, as given. */
  invalid: string[];
}

export interface AddPortalUsersRequest {
  audience: PortalAudience;
  /** Required for COHORT_MEMBERS. */
  cohortId?: string;
  /** Required for COHORT_TYPE_MEMBERS; optional filter for WAITLIST. */
  cohortType?: CohortType;
  /** Compute the counts without writing anything. */
  dryRun?: boolean;
  resubscribe?: boolean;
}

// --- Admin: subscribers -----------------------------------------------------

export interface ListSubscribersQuery extends PaginatedQuery {
  /** Matches email or name. */
  search?: string;
  status?: SubscriberStatus;
}

export interface SubscriberResponse {
  id: string;
  email: string;
  name: string | null;
  status: SubscriberStatus;
  /** Why the address is suppressed, e.g. the bounce message. */
  statusReason: string | null;
  statusChangedAt: string | null;
  /** Lists the address has a row on, in any status. */
  listCount: number;
  createdAt: string;
}

export interface UpdateSubscriberRequest {
  status?: SubscriberStatus;
  /** Null clears it. */
  name?: string | null;
}

// --- Admin: newsletters -----------------------------------------------------

export interface ListNewslettersQuery extends PaginatedQuery {
  status?: NewsletterStatus;
  /** Matches the subject. */
  search?: string;
}

/** Delivery counts. Zero everywhere until the audience is snapshotted. */
export interface NewsletterStats {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Deliveries opened at least once. Only meaningful with tracking on. */
  opened: number;
  /** Deliveries with at least one tracked click. */
  clicked: number;
}

export interface NewsletterSummaryResponse {
  id: string;
  subject: string;
  status: NewsletterStatus;
  contentFormat: NewsletterContentFormat;
  listNames: string[];
  adHocCount: number;
  trackingEnabled: boolean;
  scheduledAt: string | null;
  sendStartedAt: string | null;
  sentAt: string | null;
  /** Set while sending is held back by the daily limit or a provider throttle. */
  pausedUntil: string | null;
  pauseReason: string | null;
  stats: NewsletterStats;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewsletterDetailResponse extends NewsletterSummaryResponse {
  preheader: string | null;
  content: string;
  /** Null means the configured default Reply-To. */
  replyTo: string | null;
  listIds: string[];
  adHocEmails: string[];
}

/** Every field optional; the subject defaults to "Untitled newsletter". */
export interface CreateNewsletterRequest {
  subject?: string;
  preheader?: string | null;
  contentFormat?: NewsletterContentFormat;
  content?: string;
  replyTo?: string | null;
  listIds?: string[];
  adHocEmails?: string[];
  trackingEnabled?: boolean;
}

/** DRAFT only. Absent fields are left unchanged. */
export interface UpdateNewsletterRequest {
  subject?: string;
  preheader?: string | null;
  contentFormat?: NewsletterContentFormat;
  content?: string;
  replyTo?: string | null;
  listIds?: string[];
  adHocEmails?: string[];
  trackingEnabled?: boolean;
}

/** Unsaved editor state to preview instead of the stored fields. */
export interface PreviewNewsletterRequest {
  subject?: string;
  preheader?: string | null;
  contentFormat?: NewsletterContentFormat;
  content?: string;
}

export interface NewsletterPreviewResponse {
  subject: string;
  html: string;
  text: string;
}

/** Who a send would reach right now, and how long the daily limit makes it take. */
export interface NewsletterAudienceResponse {
  /** Unique addresses across the lists and the ad-hoc recipients. */
  total: number;
  willSend: number;
  /** Suppressed addresses that would be skipped. */
  skipped: number;
  invalidAdHoc: string[];
  dailyLimit: number;
  /** Newsletter emails sent in the last 24h, across every newsletter. */
  sentLast24h: number;
  estimatedDays: number;
}

export interface SendTestRequest {
  /** 1..10 addresses. */
  emails: string[];
}

export interface SendTestFailure {
  email: string;
  error: string;
}

export interface SendTestResponse {
  sent: string[];
  failed: SendTestFailure[];
}

export interface SendNewsletterRequest {
  /** ISO timestamp in the future. Omitted means send now; a past time is a 400. */
  scheduledAt?: string;
}

export interface ListNewsletterDeliveriesQuery extends PaginatedQuery {
  status?: NewsletterDeliveryStatus;
  /** Matches email or name. */
  search?: string;
}

export interface NewsletterDeliveryResponse {
  id: string;
  email: string;
  name: string | null;
  status: NewsletterDeliveryStatus;
  /** Failure message, or the reason a delivery was skipped. */
  error: string | null;
  attempts: number;
  sentAt: string | null;
  openedAt: string | null;
  openCount: number;
  clickCount: number;
}

export interface NewsletterSettingsResponse {
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  dailyLimit: number;
  ratePerMinute: number;
  sentLast24h: number;
  /** False when newsletters fall back to the transactional SMTP account. */
  usesDedicatedTransport: boolean;
  /** Base for the copy-paste subscribe snippet. */
  apiBaseUrl: string;
  /** Base for the embeddable subscribe iframe. */
  frontendUrl: string;
}

export interface NewsletterImageResponse {
  id: string;
  /** Public, permanent URL to put in email HTML. */
  url: string;
}
