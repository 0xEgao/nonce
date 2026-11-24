import { Chip } from '@mui/material';
import {
  type NewsletterDeliveryStatus,
  type NewsletterStatus,
  SubscriberStatus,
  SubscriptionStatus,
} from '@nonce/shared';
import {
  SUBSCRIBER_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
} from './newsletterUtils';

type Tone = 'green' | 'amber' | 'red' | 'grey' | 'blue' | 'violet';

// Same palette as the fellowship StatusChip, so the admin tables read alike.
const TONES: Record<Tone, { bg: string; color: string; border: string }> = {
  green: {
    bg: 'rgba(74,222,128,0.12)',
    color: '#4ade80',
    border: 'rgba(74,222,128,0.3)',
  },
  amber: {
    bg: 'rgba(251,191,36,0.12)',
    color: '#fbbf24',
    border: 'rgba(251,191,36,0.3)',
  },
  red: {
    bg: 'rgba(248,113,113,0.12)',
    color: '#f87171',
    border: 'rgba(248,113,113,0.3)',
  },
  grey: {
    bg: 'rgba(161,161,170,0.12)',
    color: '#d4d4d8',
    border: 'rgba(161,161,170,0.25)',
  },
  blue: {
    bg: 'rgba(96,165,250,0.12)',
    color: '#60a5fa',
    border: 'rgba(96,165,250,0.3)',
  },
  violet: {
    bg: 'rgba(167,139,250,0.12)',
    color: '#a78bfa',
    border: 'rgba(167,139,250,0.3)',
  },
};

const ToneChip = ({
  label,
  tone,
  title,
}: {
  label: string;
  tone: Tone;
  title?: string;
}) => {
  const palette = TONES[tone];
  return (
    <Chip
      size="small"
      label={label}
      title={title}
      sx={{
        bgcolor: palette.bg,
        color: palette.color,
        border: `1px solid ${palette.border}`,
        fontSize: '0.7rem',
        height: 22,
      }}
    />
  );
};

// Newsletter and delivery statuses share SENDING and SENT, with the same
// meaning, so one table covers both.
const NEWSLETTER_STATUS_STYLE: Record<
  NewsletterStatus | NewsletterDeliveryStatus,
  { tone: Tone; label: string }
> = {
  DRAFT: { tone: 'grey', label: 'Draft' },
  SCHEDULED: { tone: 'blue', label: 'Scheduled' },
  SENDING: { tone: 'amber', label: 'Sending' },
  SENT: { tone: 'green', label: 'Sent' },
  CANCELLED: { tone: 'red', label: 'Cancelled' },
  PENDING: { tone: 'grey', label: 'Pending' },
  FAILED: { tone: 'red', label: 'Failed' },
  SKIPPED: { tone: 'violet', label: 'Skipped' },
};

export const NewsletterStatusChip = ({
  status,
  label,
}: {
  status: NewsletterStatus | NewsletterDeliveryStatus;
  /** Overrides the label, e.g. "Paused" for a held-back send. */
  label?: string;
}) => {
  const style = NEWSLETTER_STATUS_STYLE[status] ?? {
    tone: 'grey' as const,
    label: status,
  };
  return <ToneChip label={label ?? style.label} tone={style.tone} />;
};

const SUBSCRIPTION_TONES: Record<SubscriptionStatus, Tone> = {
  [SubscriptionStatus.PENDING]: 'amber',
  [SubscriptionStatus.SUBSCRIBED]: 'green',
  [SubscriptionStatus.UNSUBSCRIBED]: 'grey',
};

const SUBSCRIBER_TONES: Record<SubscriberStatus, Tone> = {
  [SubscriberStatus.ACTIVE]: 'green',
  [SubscriberStatus.UNSUBSCRIBED]: 'grey',
  [SubscriberStatus.BOUNCED]: 'red',
};

export const SubscriptionStatusChip = ({
  status,
}: {
  status: SubscriptionStatus;
}) => (
  <ToneChip
    label={SUBSCRIPTION_STATUS_LABELS[status]}
    tone={SUBSCRIPTION_TONES[status]}
  />
);

export const SubscriberStatusChip = ({
  status,
  label,
}: {
  status: SubscriberStatus;
  /** Replaces the default wording, e.g. beside a per-list status chip. */
  label?: string;
}) => (
  <ToneChip
    label={label ?? SUBSCRIBER_STATUS_LABELS[status]}
    tone={SUBSCRIBER_TONES[status]}
    title={
      status === SubscriberStatus.ACTIVE
        ? undefined
        : 'This address is suppressed from every send, whatever its lists say.'
    }
  />
);

export const ListVisibilityChip = ({ isPublic }: { isPublic: boolean }) => (
  <ToneChip
    label={isPublic ? 'Public' : 'Private'}
    tone={isPublic ? 'blue' : 'grey'}
    title={
      isPublic
        ? 'Shown on the sign-up form; people can subscribe themselves.'
        : 'Only admins can add people to this list.'
    }
  />
);

export const ArchivedChip = () => <ToneChip label="Archived" tone="grey" />;
