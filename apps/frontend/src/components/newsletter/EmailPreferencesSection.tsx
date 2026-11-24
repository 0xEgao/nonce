import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useRequestPreferencesLink } from '../../hooks/newsletterHooks';
import { useUser } from '../../hooks/userHooks';
import {
  extractErrorMessage,
  isAxiosError,
  isThrottledError,
} from '../../utils/errorUtils';
import { FellowshipTheme } from '../fellowship/FellowshipTheme';

/**
 * The "Email preferences" card for a signed-in user's own profile page.
 * Nothing checks that the email on an account belongs to its user, so this
 * never shows or changes subscriptions itself: it emails the account's address
 * a link to the preferences page, and opening that proves the inbox.
 *
 * The profile page uses the default MUI theme with hand-set dark colours, so
 * the dark theme is provided here to give the alerts and button the same look.
 */
const EmailPreferencesSection = () => {
  const { data: user } = useUser();
  const requestLink = useRequestPreferencesLink();

  // The saved account address, not whatever is in the form above right now:
  // that is the one the API mails.
  const email = user?.email?.trim() ?? '';
  // The API answers 400 when the account has no email address; until the
  // user has loaded, that is the only way to know. Once it has, the user
  // decides, so adding an address and saving brings the button back.
  const noEmail = user
    ? !email
    : isAxiosError(requestLink.error) &&
      requestLink.error.response?.status === 400;

  return (
    <FellowshipTheme>
      <Box
        sx={{
          bgcolor: '#0a0a0a',
          border: '1px solid #1c1c1e',
          borderRadius: 4,
          p: { xs: 2.5, sm: 3.5 },
          color: '#fafafa',
        }}
      >
        <Typography sx={{ fontWeight: 700, fontSize: '1rem', mb: 0.5 }}>
          Email preferences
        </Typography>
        <Typography sx={{ color: '#a1a1aa', fontSize: '0.875rem', mb: 2.5 }}>
          Manage which Bitshala newsletters you get.
          {!noEmail && (
            <>
              {' '}
              We&rsquo;ll email a secure link to{' '}
              <Box
                component="strong"
                sx={{ color: '#fafafa', wordBreak: 'break-all' }}
              >
                {email || 'your account email address'}
              </Box>
              .
            </>
          )}
        </Typography>

        {noEmail ? (
          <Alert severity="info">
            Your account has no email address yet. Add one to your profile
            details above and save, then come back here to manage your
            newsletters.
          </Alert>
        ) : (
          <Stack spacing={2}>
            {requestLink.isSuccess && (
              <Alert severity="success">{requestLink.data.message}</Alert>
            )}
            {requestLink.isError && (
              <Alert severity="error">
                {isThrottledError(requestLink.error)
                  ? 'Too many requests right now. Wait a moment and try again.'
                  : extractErrorMessage(requestLink.error)}
              </Alert>
            )}
            <Button
              variant="contained"
              onClick={() => requestLink.mutate()}
              disabled={requestLink.isPending}
              startIcon={
                requestLink.isPending ? (
                  <CircularProgress size={14} color="inherit" />
                ) : undefined
              }
              sx={{ alignSelf: 'flex-start' }}
            >
              Email me the link
            </Button>
          </Stack>
        )}
      </Box>
    </FellowshipTheme>
  );
};

export default EmailPreferencesSection;
