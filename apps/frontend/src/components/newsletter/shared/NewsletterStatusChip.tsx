import { Chip } from '@mui/material';
import type { NewsletterDeliveryStatus, NewsletterStatus } from '@nonce/shared';

type Tone = 'grey' | 'blue' | 'amber' | 'green' | 'red' | 'violet';

const TONES: Record<Tone, { bg: string; color: string; border: string }> = {
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
  amber: {
    bg: 'rgba(251,191,36,0.12)',
    color: '#fbbf24',
    border: 'rgba(251,191,36,0.3)',
  },
  green: {
    bg: 'rgba(74,222,128,0.12)',
    color: '#4ade80',
    border: 'rgba(74,222,128,0.3)',
  },
  red: {
    bg: 'rgba(248,113,113,0.12)',
    color: '#f87171',
    border: 'rgba(248,113,113,0.3)',
  },
  violet: {
    bg: 'rgba(167,139,250,0.12)',
    color: '#a78bfa',
    border: 'rgba(167,139,250,0.3)',
  },
};

// Newsletter and delivery statuses share SENDING and SENT, with the same
// meaning, so one table covers both.
const STATUS_STYLE: Record<
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

interface Props {
  status: NewsletterStatus | NewsletterDeliveryStatus;
  /** Overrides the label, e.g. "Paused" for a held-back send. */
  label?: string;
  size?: 'small' | 'medium';
}

const NewsletterStatusChip = ({ status, label, size = 'small' }: Props) => {
  const style = STATUS_STYLE[status] ?? {
    tone: 'grey' as const,
    label: status,
  };
  const palette = TONES[style.tone];
  return (
    <Chip
      size={size}
      label={label ?? style.label}
      sx={{
        bgcolor: palette.bg,
        color: palette.color,
        border: `1px solid ${palette.border}`,
        fontSize: '0.7rem',
        height: size === 'small' ? 22 : 28,
        letterSpacing: 0.4,
      }}
    />
  );
};

export default NewsletterStatusChip;
