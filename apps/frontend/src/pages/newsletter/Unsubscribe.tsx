import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, CircularProgress, Stack } from '@mui/material';
import {
  AccentLink,
  PublicShell,
  StatePanel,
} from '../../components/newsletter/PublicShell';
import { PREVIEW_TOKEN } from '../../components/newsletter/newsletterUtils';
import {
  usePreferencesByToken,
  useUnsubscribe,
} from '../../hooks/newsletterHooks';
import { usePageMeta } from '../../hooks/usePageMeta';
import {
  extractErrorMessage,
  isAxiosError,
  isThrottledError,
} from '../../utils/errorUtils';

type Choice = 'newsletter' | 'all';

const Unsubscribe = () => {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  // Which newsletter the email came from. Links not made from a newsletter
  // (an old email, a hand-built URL) have none.
  const newsletterId = params.get('n') ?? '';
  const isPreview = token === PREVIEW_TOKEN;
  usePageMeta('Unsubscribe');

  // Loading the page only ever reads: the address is shown so the person can
  // see whose subscription this is. Nothing changes until a button is pressed.
  const preferences = usePreferencesByToken(token, {
    enabled: token !== '' && !isPreview,
  });
  const unsubscribe = useUnsubscribe();
  const [choice, setChoice] = useState<Choice | null>(null);

  const submit = (next: Choice) => {
    setChoice(next);
    unsubscribe.mutate(
      next === 'all' ? { token, all: true } : { token, newsletterId }
    );
  };

  const manageLink = (
    <AccentLink
      to={`/newsletter/preferences?token=${encodeURIComponent(token)}`}
    >
      Manage preferences
    </AccentLink>
  );

  let content: ReactNode;
  if (!token) {
    content = (
      <StatePanel tone="error" title="This link is incomplete">
        Open the unsubscribe link at the bottom of the email again.
      </StatePanel>
    );
  } else if (isPreview) {
    content = (
      <StatePanel tone="info" title="This is a preview link">
        Real newsletter emails get a working unsubscribe link. Nothing was
        changed.
      </StatePanel>
    );
  } else if (unsubscribe.isSuccess && unsubscribe.data) {
    const { email, unsubscribedLists, global } = unsubscribe.data;
    content = (
      <StatePanel
        tone="success"
        title="You're unsubscribed"
        actions={
          <Box sx={{ fontSize: '0.9rem', color: 'text.secondary' }}>
            Changed your mind? {manageLink}
          </Box>
        }
      >
        {global ? (
          <>
            <strong>{email}</strong> will no longer receive any Bitshala
            newsletters.
          </>
        ) : unsubscribedLists.length > 0 ? (
          <>
            <strong>{email}</strong> will no longer receive:
            <Box
              component="ul"
              sx={{
                listStyle: 'none',
                p: 0,
                m: '8px 0 0',
                color: 'text.primary',
                fontWeight: 600,
              }}
            >
              {unsubscribedLists.map(name => (
                <li key={name}>{name}</li>
              ))}
            </Box>
          </>
        ) : (
          <>
            <strong>{email}</strong> was already unsubscribed from this
            newsletter.
          </>
        )}
      </StatePanel>
    );
  } else if (preferences.isLoading) {
    content = <StatePanel tone="loading" title="One moment…" />;
  } else if (!preferences.data) {
    const status = isAxiosError(preferences.error)
      ? preferences.error.response?.status
      : undefined;
    content =
      status === 404 ? (
        <StatePanel tone="error" title="This link is invalid or has expired">
          Use the unsubscribe link in a recent newsletter email.
        </StatePanel>
      ) : (
        <StatePanel
          tone="error"
          title="We couldn't load this page"
          actions={
            <Button
              variant="outlined"
              size="small"
              onClick={() => preferences.refetch()}
            >
              Try again
            </Button>
          }
        >
          {isThrottledError(preferences.error)
            ? 'Too many requests right now. Wait a moment and try again.'
            : extractErrorMessage(preferences.error)}
        </StatePanel>
      );
  } else {
    const { email } = preferences.data;
    content = (
      <Stack spacing={2.5}>
        <Box>
          <Box
            component="h1"
            sx={{ m: 0, fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.25 }}
          >
            Unsubscribe
          </Box>
          <Box sx={{ color: 'text.secondary', mt: 1, fontSize: '0.92rem' }}>
            <Box
              component="strong"
              sx={{ color: 'text.primary', wordBreak: 'break-all' }}
            >
              {email}
            </Box>{' '}
            {newsletterId
              ? 'is currently subscribed to this newsletter. Choose what you would like to stop receiving.'
              : 'receives Bitshala newsletters. You can stop all of them here.'}
          </Box>
        </Box>

        {unsubscribe.isError && (
          <Alert severity="error">
            {isThrottledError(unsubscribe.error)
              ? 'Too many requests right now. Wait a moment and try again.'
              : extractErrorMessage(unsubscribe.error)}
          </Alert>
        )}

        <Stack spacing={1.25}>
          {newsletterId && (
            <Button
              variant="contained"
              fullWidth
              disabled={unsubscribe.isPending}
              onClick={() => submit('newsletter')}
              startIcon={
                unsubscribe.isPending && choice === 'newsletter' ? (
                  <CircularProgress size={14} color="inherit" />
                ) : undefined
              }
              sx={{ py: 1.1 }}
            >
              Unsubscribe
            </Button>
          )}
          <Button
            variant={newsletterId ? 'outlined' : 'contained'}
            fullWidth
            disabled={unsubscribe.isPending}
            onClick={() => submit('all')}
            startIcon={
              unsubscribe.isPending && choice === 'all' ? (
                <CircularProgress size={14} color="inherit" />
              ) : undefined
            }
            sx={
              newsletterId
                ? { py: 1.1, color: 'text.primary', borderColor: 'divider' }
                : { py: 1.1 }
            }
          >
            Unsubscribe from all Bitshala newsletters
          </Button>
        </Stack>

        <Box sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
          Rather pick which newsletters you get? {manageLink}
        </Box>
      </Stack>
    );
  }

  return <PublicShell>{content}</PublicShell>;
};

export default Unsubscribe;
