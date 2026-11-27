import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { Ban, ChevronDown, ChevronUp, Copy, RefreshCw } from 'lucide-react';
import { type NewsletterDetailResponse, NewsletterStatus } from '@nonce/shared';
import {
  useCancelNewsletter,
  useDuplicateNewsletter,
  useRetryFailedDeliveries,
} from '../../../hooks/newsletterHooks';
import { formatDateTime } from '../../../utils/dateUtils';
import { fontFamilyMono } from '../../fellowship/theme';
import ConfirmDialog from '../shared/ConfirmDialog';
import DeliveriesTable from './DeliveriesTable';
import NewsletterHeader, { DetailRow } from '../shared/NewsletterHeader';
import {
  apiErrorMessage,
  isPausedNow,
  plural,
} from '../shared/newsletterUtils';
import { describeAudience } from '../composer/composerUtils';
import StoredPreview from '../composer/StoredPreview';

interface Props {
  newsletter: NewsletterDetailResponse;
}

const percentOf = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';

/** SENDING, SENT and CANCELLED: progress, counts and every delivery. */
const NewsletterReport = ({ newsletter }: Props) => {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<'cancel' | 'retry' | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useCancelNewsletter();
  const retry = useRetryFailedDeliveries();
  const duplicate = useDuplicateNewsletter();

  const { stats } = newsletter;
  const sending = newsletter.status === NewsletterStatus.SENDING;
  // The API refuses a retry on anything but SENDING and SENT.
  const canRetry =
    stats.failed > 0 &&
    (sending || newsletter.status === NewsletterStatus.SENT);
  const paused = sending && isPausedNow(newsletter.pausedUntil);
  const processed = stats.sent + stats.failed + stats.skipped;
  const progress = stats.total > 0 ? (processed / stats.total) * 100 : 0;
  // Before the audience is snapshotted every count is zero.
  const preparing = sending && stats.total === 0;

  const handleDuplicate = async () => {
    setError(null);
    try {
      const copy = await duplicate.mutateAsync({ id: newsletter.id });
      navigate(`/admin/newsletter/${copy.id}`);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  return (
    <>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <NewsletterHeader
        newsletter={newsletter}
        actions={
          <>
            {canRetry && (
              <Button
                variant="outlined"
                startIcon={<RefreshCw size={14} />}
                onClick={() => setConfirm('retry')}
                sx={{ color: 'text.primary', borderColor: 'divider' }}
              >
                Retry failed
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<Copy size={14} />}
              onClick={handleDuplicate}
              disabled={duplicate.isPending}
              sx={{ color: 'text.primary', borderColor: 'divider' }}
            >
              Duplicate
            </Button>
            {sending && (
              <Button
                variant="outlined"
                color="error"
                startIcon={<Ban size={14} />}
                onClick={() => setConfirm('cancel')}
              >
                Cancel sending
              </Button>
            )}
          </>
        }
      />

      {paused && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Sending is paused:{' '}
          {newsletter.pauseReason ?? 'the daily sending limit was reached'}. It
          picks up again on its own around{' '}
          <strong>{formatDateTime(newsletter.pausedUntil)}</strong>.
        </Alert>
      )}
      {newsletter.status === NewsletterStatus.CANCELLED && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Sending was cancelled. Recipients who had not been sent to yet were
          skipped.
        </Alert>
      )}

      {/* ---- progress ---- */}
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paper',
          p: 2.5,
          mb: 3,
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="baseline"
          sx={{ mb: 1 }}
        >
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>
            {preparing
              ? 'Preparing the recipient list…'
              : `${processed.toLocaleString()} of ${plural(stats.total, 'recipient')} processed`}
          </Typography>
          {!preparing && (
            <Typography
              sx={{
                fontFamily: fontFamilyMono,
                fontSize: '0.8rem',
                color: 'text.secondary',
              }}
            >
              {Math.floor(progress)}%
            </Typography>
          )}
        </Stack>
        <LinearProgress
          variant={preparing ? 'indeterminate' : 'determinate'}
          value={progress}
          color={paused ? 'warning' : 'primary'}
          sx={{ height: 6, borderRadius: 3, bgcolor: '#27272a' }}
        />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(3, minmax(0, 1fr))',
              lg: `repeat(${newsletter.trackingEnabled ? 7 : 5}, minmax(0, 1fr))`,
            },
            gap: 1.5,
            mt: 2.5,
          }}
        >
          <StatTile label="Recipients" value={stats.total} />
          <StatTile
            label="Sent"
            value={stats.sent}
            color="#4ade80"
            note={percentOf(stats.sent, stats.total)}
          />
          <StatTile label="Pending" value={stats.pending} />
          <StatTile
            label="Failed"
            value={stats.failed}
            color={stats.failed > 0 ? '#f87171' : undefined}
          />
          <StatTile
            label="Skipped"
            value={stats.skipped}
            color={stats.skipped > 0 ? '#a78bfa' : undefined}
            note="Unsubscribed, bounced or cancelled"
          />
          {newsletter.trackingEnabled && (
            <>
              <StatTile
                label="Opened"
                value={stats.opened}
                color="#60a5fa"
                note={`${percentOf(stats.opened, stats.sent)} of sent`}
              />
              <StatTile
                label="Clicked"
                value={stats.clicked}
                color="#60a5fa"
                note={`${percentOf(stats.clicked, stats.sent)} of sent`}
              />
            </>
          )}
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 1.25,
            mt: 2.5,
          }}
        >
          <DetailRow
            label="Started"
            value={formatDateTime(newsletter.sendStartedAt)}
          />
          <DetailRow
            label={
              newsletter.status === NewsletterStatus.CANCELLED
                ? 'Last update'
                : 'Finished'
            }
            value={
              newsletter.status === NewsletterStatus.CANCELLED
                ? formatDateTime(newsletter.updatedAt)
                : formatDateTime(newsletter.sentAt)
            }
          />
          <DetailRow
            label="Audience"
            value={describeAudience(
              newsletter.listNames,
              newsletter.adHocCount
            )}
          />
          <DetailRow
            label="Tracking"
            value={newsletter.trackingEnabled ? 'Opens and clicks' : 'Off'}
          />
          <DetailRow
            label="Created by"
            value={newsletter.createdByName ?? '—'}
          />
          {newsletter.scheduledAt && (
            <DetailRow
              label="Scheduled"
              value={formatDateTime(newsletter.scheduledAt)}
            />
          )}
        </Box>
      </Box>

      {/* ---- preview ---- */}
      <Box sx={{ mb: 3 }}>
        <Button
          onClick={() => setShowPreview(v => !v)}
          endIcon={
            showPreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />
          }
          sx={{ color: 'text.secondary', px: 0, mb: 1 }}
        >
          {showPreview ? 'Hide the email' : 'Show the email'}
        </Button>
        {showPreview && (
          <StoredPreview
            newsletterId={newsletter.id}
            preheader={newsletter.preheader}
          />
        )}
      </Box>

      {/* ---- deliveries ---- */}
      <Typography
        sx={{
          fontSize: '0.7rem',
          letterSpacing: 0.8,
          fontWeight: 700,
          textTransform: 'uppercase',
          color: 'text.secondary',
          mb: 1.5,
        }}
      >
        Deliveries
      </Typography>
      <DeliveriesTable
        newsletterId={newsletter.id}
        trackingEnabled={newsletter.trackingEnabled}
        live={sending && !paused}
      />

      <ConfirmDialog
        open={confirm === 'cancel'}
        title="Stop sending?"
        confirmLabel="Stop sending"
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={() => cancel.mutateAsync({ id: newsletter.id })}
      >
        Emails already sent stay sent. The {plural(stats.pending, 'recipient')}{' '}
        still waiting will be skipped. This can't be undone.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'retry'}
        title="Retry failed deliveries?"
        confirmLabel="Retry"
        onClose={() => setConfirm(null)}
        onConfirm={() => retry.mutateAsync({ id: newsletter.id })}
      >
        Up to {plural(stats.failed, 'failed delivery', 'failed deliveries')}{' '}
        will be queued again and sending resumes. Addresses that bounced,
        unsubscribed, left this newsletter's lists or were deleted are left out.
      </ConfirmDialog>
    </>
  );
};

const StatTile = ({
  label,
  value,
  color,
  note,
}: {
  label: string;
  value: number;
  color?: string;
  note?: string;
}) => (
  <Box
    sx={{
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 0.75,
      px: 1.75,
      py: 1.25,
      bgcolor: 'rgba(255,255,255,0.02)',
      minWidth: 0,
    }}
  >
    <Typography
      sx={{
        fontSize: '0.66rem',
        letterSpacing: 0.8,
        fontWeight: 700,
        textTransform: 'uppercase',
        color: 'text.secondary',
      }}
    >
      {label}
    </Typography>
    <Typography
      sx={{
        fontFamily: fontFamilyMono,
        fontSize: '1.35rem',
        fontWeight: 700,
        color: color ?? 'text.primary',
        lineHeight: 1.3,
      }}
    >
      {value.toLocaleString()}
    </Typography>
    {note && (
      <Typography
        title={note}
        sx={{
          fontSize: '0.7rem',
          color: 'text.secondary',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {note}
      </Typography>
    )}
  </Box>
);

export default NewsletterReport;
