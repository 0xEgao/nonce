import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { type NewsletterDetailResponse, NewsletterStatus } from '@nonce/shared';
import FellowshipPageLayout from '../../../components/fellowship/FellowshipPageLayout';
import NewsletterAdminTabs from '../../../components/newsletter/NewsletterAdminTabs';
import NewsletterComposer from '../../../components/newsletter/composer/NewsletterComposer';
import NewsletterReport from '../../../components/newsletter/composer/NewsletterReport';
import NewsletterScheduledView from '../../../components/newsletter/composer/NewsletterScheduledView';
import { useNewsletter } from '../../../hooks/newsletterHooks';
import {
  apiErrorMessage,
  isPausedNow,
} from '../../../components/newsletter/composer/newsletterUtils';
import { isAxiosError } from '../../../utils/errorUtils';

const LIVE_POLL_MS = 4000;
const SLOW_POLL_MS = 30000;

// Fast while deliveries are moving; slow while a send is paused or waiting
// for its scheduled time, just to notice when it starts.
const pollInterval = (
  newsletter: NewsletterDetailResponse | undefined
): number | false => {
  if (newsletter?.status === NewsletterStatus.SENDING) {
    return isPausedNow(newsletter.pausedUntil) ? SLOW_POLL_MS : LIVE_POLL_MS;
  }
  if (newsletter?.status === NewsletterStatus.SCHEDULED) return SLOW_POLL_MS;
  return false;
};

const NewsletterDetail = () => {
  const { newsletterId = '' } = useParams<{ newsletterId: string }>();
  const {
    data: newsletter,
    error,
    isError,
    isFetchedAfterMount,
  } = useNewsletter(newsletterId, {
    enabled: !!newsletterId,
    staleTime: 0,
    refetchInterval: query => pollInterval(query.state.data),
  });

  const status = isAxiosError(error) ? error.response?.status : undefined;
  // 400 is a malformed id in the URL.
  const notFound = isError && (status === 404 || status === 400);
  // The composer seeds its fields once, so a draft waits for a fetch made on
  // this visit rather than starting from a cached copy that may be stale.
  const ready =
    !!newsletter &&
    (newsletter.status !== NewsletterStatus.DRAFT || isFetchedAfterMount);

  return (
    <FellowshipPageLayout
      title="Newsletter"
      subtitle="Write, schedule and send newsletters."
      badge="Admin"
      hideIcon
    >
      <NewsletterAdminTabs />

      <Button
        component={RouterLink}
        to="/admin/newsletter"
        startIcon={<ArrowLeft size={14} />}
        sx={{
          mb: 2,
          pl: 0,
          color: 'text.secondary',
          '&:hover': { bgcolor: 'transparent', color: 'text.primary' },
        }}
      >
        All newsletters
      </Button>

      {notFound ? (
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 700, mb: 0.5 }}>
            Newsletter not found
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            It may have been deleted.
          </Typography>
        </Box>
      ) : isError && !newsletter ? (
        <Alert severity="error">
          Couldn't load this newsletter: {apiErrorMessage(error)}
        </Alert>
      ) : !ready ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <>
          {isError && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Couldn't refresh this newsletter: {apiErrorMessage(error)}
            </Alert>
          )}
          {newsletter.status === NewsletterStatus.DRAFT ? (
            <NewsletterComposer key={newsletter.id} newsletter={newsletter} />
          ) : newsletter.status === NewsletterStatus.SCHEDULED ? (
            <NewsletterScheduledView
              key={newsletter.id}
              newsletter={newsletter}
            />
          ) : (
            <NewsletterReport key={newsletter.id} newsletter={newsletter} />
          )}
        </>
      )}
    </FellowshipPageLayout>
  );
};

export default NewsletterDetail;
