import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { CalendarClock, Copy, RotateCcw } from 'lucide-react';
import type { NewsletterDetailResponse } from '@nonce/shared';
import {
  useDuplicateNewsletter,
  useUnscheduleNewsletter,
} from '../../../hooks/newsletterHooks';
import { formatDateTime } from '../../../utils/dateUtils';
import ConfirmDialog from '../composer/ConfirmDialog';
import NewsletterHeader, { DetailRow } from '../shared/NewsletterHeader';
import { apiErrorMessage, describeAudience } from '../composer/newsletterUtils';
import StoredPreview from '../composer/StoredPreview';

interface Props {
  newsletter: NewsletterDetailResponse;
}

/** Read-only while the send waits for its time; unscheduling makes it editable. */
const NewsletterScheduledView = ({ newsletter }: Props) => {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unschedule = useUnscheduleNewsletter();
  const duplicate = useDuplicateNewsletter();

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
            <Button
              variant="outlined"
              startIcon={<Copy size={14} />}
              onClick={handleDuplicate}
              disabled={duplicate.isPending}
              sx={{ color: 'text.primary', borderColor: 'divider' }}
            >
              Duplicate
            </Button>
            <Button
              variant="contained"
              startIcon={<RotateCcw size={14} />}
              onClick={() => setConfirmOpen(true)}
            >
              Unschedule
            </Button>
          </>
        }
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            lg: '360px minmax(0, 1fr)',
          },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'background.paper',
            p: 2.5,
          }}
        >
          <Stack
            direction="row"
            spacing={1.25}
            alignItems="center"
            sx={{ mb: 2 }}
          >
            <Box sx={{ color: 'info.main', display: 'flex' }}>
              <CalendarClock size={20} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                Sends on
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>
                {formatDateTime(newsletter.scheduledAt)}
              </Typography>
            </Box>
          </Stack>
          <Stack spacing={1.25}>
            <DetailRow
              label="Audience"
              value={describeAudience(
                newsletter.listNames,
                newsletter.adHocCount
              )}
            />
            <DetailRow
              label="Reply-to"
              value={newsletter.replyTo ?? 'Default'}
            />
            <DetailRow
              label="Tracking"
              value={newsletter.trackingEnabled ? 'Opens and clicks' : 'Off'}
            />
            <DetailRow
              label="Created by"
              value={newsletter.createdByName ?? '—'}
            />
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2.5 }}>
            Recipients are worked out when sending starts, so anyone who
            subscribes or unsubscribes before then is counted correctly. To
            change anything, unschedule it first.
          </Typography>
        </Box>

        <StoredPreview
          newsletterId={newsletter.id}
          preheader={newsletter.preheader}
        />
      </Box>

      <ConfirmDialog
        open={confirmOpen}
        title="Unschedule this newsletter?"
        confirmLabel="Unschedule"
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => unschedule.mutateAsync({ id: newsletter.id })}
      >
        It goes back to being a draft, and nothing is sent until you send or
        schedule it again.
      </ConfirmDialog>
    </>
  );
};

export default NewsletterScheduledView;
