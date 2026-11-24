import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Check, CircleX } from 'lucide-react';
import type { SendTestResponse } from '@nonce/shared';
import { useAuth } from '../../../hooks/useAuth';
import { useSendTestNewsletter } from '../../../hooks/newsletterHooks';
import { useUser } from '../../../hooks/userHooks';
import { fontFamilyMono } from '../../fellowship/theme';
import {
  apiErrorMessage,
  MAX_TEST_RECIPIENTS,
  parseEmailList,
  plural,
} from './newsletterUtils';

interface Props {
  open: boolean;
  newsletterId: string;
  onClose: () => void;
}

const SendTestDialog = ({ open, newsletterId, onClose }: Props) => (
  <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
    {open && <SendTestForm newsletterId={newsletterId} onClose={onClose} />}
  </Dialog>
);

const SendTestForm = ({ newsletterId, onClose }: Omit<Props, 'open'>) => {
  const { isAuthenticated } = useAuth();
  const { data: user } = useUser(undefined, { enabled: isAuthenticated });
  // Null until edited, so the signed-in admin's address can arrive late and
  // still prefill the box.
  const [text, setText] = useState<string | null>(null);
  const [result, setResult] = useState<SendTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sendTest = useSendTestNewsletter();

  const value = text ?? user?.email ?? '';
  const parsed = useMemo(() => parseEmailList(value), [value]);
  const tooMany = parsed.valid.length > MAX_TEST_RECIPIENTS;
  const canSend =
    parsed.valid.length > 0 &&
    parsed.invalid.length === 0 &&
    !tooMany &&
    !sendTest.isPending;

  const send = async () => {
    setError(null);
    setResult(null);
    try {
      const response = await sendTest.mutateAsync({
        id: newsletterId,
        body: { emails: parsed.valid },
      });
      setResult(response);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  return (
    <Box
      component="form"
      onSubmit={e => {
        e.preventDefault();
        if (canSend) void send();
      }}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>Send a test</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Sends the saved version with "[TEST]" in front of the subject. Merge
          tags use a sample recipient and the unsubscribe links go nowhere.
        </Typography>
        <TextField
          label="Send to"
          fullWidth
          multiline
          minRows={2}
          value={value}
          onChange={e => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder="you@example.com, teammate@example.com"
          error={parsed.invalid.length > 0 || tooMany}
          helperText={
            parsed.invalid.length > 0
              ? `Not valid: ${parsed.invalid.join(', ')}`
              : tooMany
                ? `At most ${MAX_TEST_RECIPIENTS} addresses per test.`
                : `Up to ${MAX_TEST_RECIPIENTS} addresses, separated by commas or new lines.`
          }
          autoFocus
        />
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        {result && (
          <Stack spacing={0.75} sx={{ mt: 2 }}>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>
              {plural(result.sent.length, 'test')} sent
              {result.failed.length > 0 && `, ${result.failed.length} failed`}
            </Typography>
            {result.sent.map(email => (
              <ResultRow key={email} email={email} />
            ))}
            {result.failed.map(failure => (
              <ResultRow
                key={failure.email}
                email={failure.email}
                error={failure.error}
              />
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{result ? 'Done' : 'Cancel'}</Button>
        <Button
          type="submit"
          variant="contained"
          disabled={!canSend}
          startIcon={
            sendTest.isPending ? <CircularProgress size={14} /> : undefined
          }
        >
          {sendTest.isPending
            ? 'Sending…'
            : result
              ? 'Send again'
              : `Send test${parsed.valid.length > 1 ? `s (${parsed.valid.length})` : ''}`}
        </Button>
      </DialogActions>
    </Box>
  );
};

const ResultRow = ({ email, error }: { email: string; error?: string }) => (
  <Stack direction="row" spacing={1} alignItems="flex-start">
    <Box sx={{ mt: '2px', color: error ? 'error.main' : 'success.main' }}>
      {error ? <CircleX size={14} /> : <Check size={14} />}
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontFamily: fontFamilyMono, fontSize: '0.78rem' }}>
        {email}
      </Typography>
      {error && (
        <Typography sx={{ fontSize: '0.75rem', color: 'error.main' }}>
          {error}
        </Typography>
      )}
    </Box>
  </Stack>
);

export default SendTestDialog;
