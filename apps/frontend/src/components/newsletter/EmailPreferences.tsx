import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material';
import {
  SubscriberStatus,
  SubscriptionStatus,
  type SubscriberPreferencesResponse,
} from '@nonce/shared';
import {
  usePreferencesByToken,
  useUpdatePreferencesByToken,
} from '../../hooks/newsletterHooks';
import {
  extractErrorMessage,
  isAxiosError,
  isThrottledError,
} from '../../utils/errorUtils';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  /** The subscriber token from the email link: the only credential here. */
  token: string;
}

// A row the address asked for but has not confirmed still counts as ticked:
// the token proves they own the address, and saving with it unticked would
// silently cancel a sign-up they made.
const wantsList = (status: SubscriptionStatus | null): boolean =>
  status === SubscriptionStatus.SUBSCRIBED ||
  status === SubscriptionStatus.PENDING;

const suppressionNotice = (status: SubscriberStatus): string | null => {
  if (status === SubscriberStatus.UNSUBSCRIBED) {
    return 'You are unsubscribed from all Bitshala newsletters. Tick a list and save to start receiving emails again.';
  }
  if (status === SubscriberStatus.BOUNCED) {
    return 'Emails to this address recently bounced, so sending is paused. Tick a list and save to turn it back on.';
  }
  return null;
};

/**
 * The checkboxes for choosing which lists an address receives, on the public
 * preferences page. Signed-in users get here too, from the link the profile
 * page emails them. Renders no frame of its own.
 */
const EmailPreferences = ({ token }: Props) => {
  const query = usePreferencesByToken(token);
  const save = useUpdatePreferencesByToken();

  // Null until the person touches a box; until then the server's answer rules.
  const [edited, setEdited] = useState<ReadonlySet<string> | null>(null);
  const [confirmingUnsubscribeAll, setConfirmingUnsubscribeAll] =
    useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const preferences: SubscriberPreferencesResponse | undefined = query.data;

  if (query.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} sx={{ color: '#fb923c' }} />
      </Box>
    );
  }

  if (!preferences) {
    if (isAxiosError(query.error) && query.error.response?.status === 404) {
      return (
        <Alert severity="error">
          This link is invalid or has expired. Use the link in a recent
          newsletter email to manage your preferences.
        </Alert>
      );
    }
    return (
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => query.refetch()}>
            Retry
          </Button>
        }
      >
        {isThrottledError(query.error)
          ? 'Too many requests right now. Wait a moment and retry.'
          : `Couldn't load your email preferences: ${extractErrorMessage(query.error)}`}
      </Alert>
    );
  }

  const initialSelection = new Set(
    preferences.lists
      .filter(list => wantsList(list.status))
      .map(list => list.id)
  );
  const selection = edited ?? initialSelection;
  // A ticked unconfirmed list is also worth saving: that is what confirms it.
  const dirty =
    selection.size !== initialSelection.size ||
    [...selection].some(id => !initialSelection.has(id)) ||
    preferences.lists.some(
      list =>
        list.status === SubscriptionStatus.PENDING && selection.has(list.id)
    );
  const notice = suppressionNotice(preferences.status);

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selection);
    if (checked) next.add(id);
    else next.delete(id);
    setEdited(next);
    setSaved(null);
  };

  const submit = async (unsubscribeAll: boolean) => {
    await save.mutateAsync({
      token,
      subscribedListIds: unsubscribeAll ? [] : [...selection],
      ...(unsubscribeAll ? { unsubscribeAll: true } : {}),
    });
    setEdited(null);
    setSaved(
      unsubscribeAll
        ? 'You are unsubscribed from all Bitshala newsletters.'
        : 'Preferences saved.'
    );
  };

  const saveSelection = async () => {
    try {
      await submit(false);
    } catch {
      // Shown from `save.error` below.
    }
  };

  return (
    <Stack spacing={2}>
      <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>
        Preferences for{' '}
        <Box
          component="strong"
          sx={{ color: 'text.primary', wordBreak: 'break-all' }}
        >
          {preferences.email}
        </Box>
        .
      </Typography>

      {notice && <Alert severity="warning">{notice}</Alert>}
      {saved && <Alert severity="success">{saved}</Alert>}
      {save.isError && (
        <Alert severity="error">
          {isThrottledError(save.error)
            ? 'Too many requests right now. Wait a moment and try again.'
            : extractErrorMessage(save.error)}
        </Alert>
      )}

      {preferences.lists.length === 0 ? (
        <Typography sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>
          There are no newsletters to subscribe to right now.
        </Typography>
      ) : (
        <Stack spacing={1} component="fieldset" sx={{ border: 0, m: 0, p: 0 }}>
          <legend style={{ position: 'absolute', left: -9999 }}>
            Newsletters
          </legend>
          {preferences.lists.map(list => (
            <FormControlLabel
              key={list.id}
              sx={{ alignItems: 'flex-start', m: 0 }}
              control={
                <Checkbox
                  checked={selection.has(list.id)}
                  onChange={event => toggle(list.id, event.target.checked)}
                  disabled={save.isPending}
                  sx={{ pt: 0.5 }}
                />
              }
              label={
                <Box sx={{ pt: 0.5 }}>
                  <Typography sx={{ fontWeight: 600, fontSize: '0.92rem' }}>
                    {list.name}
                  </Typography>
                  {list.description && (
                    <Typography
                      sx={{ color: 'text.secondary', fontSize: '0.82rem' }}
                    >
                      {list.description}
                    </Typography>
                  )}
                  {list.status === SubscriptionStatus.PENDING && (
                    <Typography
                      sx={{ color: 'warning.main', fontSize: '0.78rem' }}
                    >
                      Waiting for you to confirm by email. Saving confirms it.
                    </Typography>
                  )}
                </Box>
              }
            />
          ))}
        </Stack>
      )}

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
        sx={{ pt: 1 }}
      >
        <Button
          variant="contained"
          onClick={saveSelection}
          disabled={!dirty || save.isPending || preferences.lists.length === 0}
          startIcon={
            save.isPending ? (
              <CircularProgress size={14} color="inherit" />
            ) : undefined
          }
        >
          Save preferences
        </Button>
        <Button
          onClick={() => setConfirmingUnsubscribeAll(true)}
          disabled={
            save.isPending ||
            preferences.status === SubscriberStatus.UNSUBSCRIBED
          }
          sx={{ color: 'error.main' }}
        >
          Unsubscribe from everything
        </Button>
      </Stack>

      {confirmingUnsubscribeAll && (
        <ConfirmDialog
          title="Unsubscribe from everything?"
          confirmLabel="Unsubscribe"
          destructive
          onClose={() => setConfirmingUnsubscribeAll(false)}
          onConfirm={() => submit(true)}
        >
          You will stop receiving every Bitshala newsletter at{' '}
          <strong>{preferences.email}</strong> until you subscribe again.
        </ConfirmDialog>
      )}
    </Stack>
  );
};

export default EmailPreferences;
