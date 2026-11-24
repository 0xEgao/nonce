import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, CircularProgress, Stack } from '@mui/material';
import {
  AccentLink,
  PublicShell,
  StatePanel,
} from '../../components/newsletter/PublicShell';
import { PREVIEW_TOKEN } from '../../components/newsletter/newsletterUtils';
import { useConfirmSubscription } from '../../hooks/newsletterHooks';
import { usePageMeta } from '../../hooks/usePageMeta';
import {
  extractErrorMessage,
  isAxiosError,
  isThrottledError,
} from '../../utils/errorUtils';

const Confirm = () => {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  usePageMeta('Confirm your subscription');

  // Nothing is posted until the button is pressed: mail security scanners
  // open links and run their scripts, and confirming on load would let them
  // subscribe (or reactivate) an address with no person involved.
  const confirmation = useConfirmSubscription();
  const confirm = () => confirmation.mutate({ token });

  let content: ReactNode;
  if (!token) {
    content = (
      <StatePanel tone="error" title="This link is incomplete">
        Open the confirmation link in your email again, or sign up once more.
      </StatePanel>
    );
  } else if (token === PREVIEW_TOKEN) {
    content = (
      <StatePanel tone="info" title="This is a preview link">
        Real confirmation emails get a working link. Nothing was changed.
      </StatePanel>
    );
  } else if (confirmation.isSuccess) {
    const { email, lists } = confirmation.data;
    content = (
      <StatePanel
        tone="success"
        title="You're subscribed"
        actions={
          <AccentLink
            to={`/newsletter/preferences?token=${encodeURIComponent(token)}`}
          >
            Manage your email preferences
          </AccentLink>
        }
      >
        <Box component="p" sx={{ m: 0 }}>
          <strong>{email}</strong> will now receive
        </Box>
        {lists.length > 0 ? (
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
            {lists.map(name => (
              <li key={name}>{name}</li>
            ))}
          </Box>
        ) : (
          <Box component="p" sx={{ m: '8px 0 0' }}>
            the newsletters you signed up for.
          </Box>
        )}
      </StatePanel>
    );
  } else if (confirmation.isError) {
    const { error } = confirmation;
    const status = isAxiosError(error) ? error.response?.status : undefined;
    content =
      status === 404 ? (
        <StatePanel tone="error" title="This link is invalid or has expired">
          Confirmation links stop working after a while. You can sign up again
          to get a fresh one.
        </StatePanel>
      ) : (
        <StatePanel
          tone="error"
          title="We couldn't confirm your subscription"
          actions={
            <Button variant="outlined" size="small" onClick={confirm}>
              Try again
            </Button>
          }
        >
          {isThrottledError(error)
            ? 'Too many requests right now. Wait a moment and try again.'
            : extractErrorMessage(error)}
        </StatePanel>
      );
  } else {
    content = (
      <Stack spacing={2.5}>
        <Box>
          <Box
            component="h1"
            sx={{ m: 0, fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.25 }}
          >
            Confirm your subscription
          </Box>
          <Box sx={{ color: 'text.secondary', mt: 1, fontSize: '0.92rem' }}>
            Press the button below to start receiving the Bitshala newsletters
            you signed up for.
          </Box>
        </Box>

        <Button
          variant="contained"
          fullWidth
          disabled={confirmation.isPending}
          onClick={confirm}
          startIcon={
            confirmation.isPending ? (
              <CircularProgress size={14} color="inherit" />
            ) : undefined
          }
          sx={{ py: 1.1 }}
        >
          Confirm subscription
        </Button>

        <Box sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
          Didn&rsquo;t sign up? Just close this page and you won&rsquo;t be
          subscribed to anything.
        </Box>
      </Stack>
    );
  }

  return <PublicShell>{content}</PublicShell>;
};

export default Confirm;
