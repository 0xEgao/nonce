import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import dayjs, { type Dayjs } from 'dayjs';
import { useNewsletterAudience } from '../../../hooks/newsletterHooks';
import { fontFamilyMono } from '../../fellowship/theme';
import { apiErrorMessage, plural } from '../shared/newsletterUtils';

interface Props {
  open: boolean;
  newsletterId: string;
  /** Blocking issues found in the form, e.g. no subject. */
  problems: string[];
  onClose: () => void;
  /** Rejects with the API error, which the dialog shows. */
  onConfirm: (scheduledAt?: string) => Promise<void>;
}

const SendDialog = ({ open, onClose, ...rest }: Props) => (
  <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
    {open && <SendForm onClose={onClose} {...rest} />}
  </Dialog>
);

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const SendForm = ({
  newsletterId,
  problems,
  onClose,
  onConfirm,
}: Omit<Props, 'open'>) => {
  // Always fresh: the audience moves with every subscribe and unsubscribe.
  const audienceQuery = useNewsletterAudience(newsletterId, { staleTime: 0 });
  const audience = audienceQuery.data;
  const [mode, setMode] = useState<'now' | 'later'>('now');
  const [when, setWhen] = useState<Dayjs | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const whenError =
    mode !== 'later'
      ? null
      : !when || !when.isValid()
        ? 'Pick a date and time.'
        : !when.isAfter(dayjs().add(1, 'minute'))
          ? 'Pick a time in the future.'
          : null;

  const recipients = audience?.willSend ?? 0;
  const canConfirm =
    !!audience &&
    recipients > 0 &&
    problems.length === 0 &&
    !whenError &&
    !busy;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(
        mode === 'later' && when ? when.toDate().toISOString() : undefined
      );
      // On success the newsletter leaves DRAFT and this dialog unmounts with
      // the composer.
    } catch (e) {
      setError(apiErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <>
      <DialogTitle sx={{ fontWeight: 700 }}>Send newsletter</DialogTitle>
      <DialogContent>
        {problems.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Fix these before sending:
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {problems.map(problem => (
                <li key={problem}>{problem}</li>
              ))}
            </Box>
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {audienceQuery.isLoading || (!audience && !audienceQuery.isError) ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={22} />
          </Box>
        ) : audienceQuery.isError || !audience ? (
          <Alert severity="error">
            Couldn't work out the audience:{' '}
            {apiErrorMessage(audienceQuery.error)}
          </Alert>
        ) : (
          <Stack spacing={1.5}>
            <Box>
              <Typography
                sx={{
                  fontFamily: fontFamilyMono,
                  fontSize: '2rem',
                  fontWeight: 700,
                  lineHeight: 1.1,
                  color: recipients > 0 ? 'text.primary' : 'error.main',
                }}
              >
                {recipients.toLocaleString()}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {recipients === 1 ? 'recipient' : 'recipients'} will get this
                email
                {audience.total !== recipients &&
                  ` (of ${plural(audience.total, 'unique address', 'unique addresses')})`}
                .
              </Typography>
            </Box>

            {recipients === 0 && (
              <Alert severity="error">
                Nobody to send to. Pick a list with subscribers or add
                addresses.
              </Alert>
            )}

            {audience.skipped > 0 && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {plural(audience.skipped, 'address', 'addresses')} skipped
                because they unsubscribed or bounced.
              </Typography>
            )}

            {audience.invalidAdHoc.length > 0 && (
              <Alert severity="warning">
                {plural(
                  audience.invalidAdHoc.length,
                  'ad-hoc address is',
                  'ad-hoc addresses are'
                )}{' '}
                not valid and will be left out:{' '}
                <Box component="span" sx={{ fontFamily: fontFamilyMono }}>
                  {audience.invalidAdHoc.join(', ')}
                </Box>
              </Alert>
            )}

            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Daily limit {audience.dailyLimit.toLocaleString()} emails per 24
              hours; {audience.sentLast24h.toLocaleString()} sent in the last 24
              hours.
            </Typography>

            {audience.estimatedDays > 1 && (
              <Alert severity="info">
                This will take about {plural(audience.estimatedDays, 'day')}.
                Sending pauses at the daily limit and picks up again on its own.
              </Alert>
            )}

            <RadioGroup
              value={mode}
              onChange={e => setMode(e.target.value as 'now' | 'later')}
              sx={{ pt: 1 }}
            >
              <FormControlLabel
                value="now"
                control={<Radio size="small" />}
                label="Send now"
              />
              <FormControlLabel
                value="later"
                control={<Radio size="small" />}
                label="Schedule for later"
              />
            </RadioGroup>

            {mode === 'later' && (
              <LocalizationProvider dateAdapter={AdapterDayjs}>
                <DateTimePicker
                  label="Send at"
                  value={when}
                  onChange={setWhen}
                  disablePast
                  slotProps={{
                    textField: {
                      size: 'small',
                      fullWidth: true,
                      error: !!when && !!whenError,
                      helperText:
                        (when && whenError) || `Your local time (${timeZone}).`,
                    },
                  }}
                />
              </LocalizationProvider>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={confirm}
          disabled={!canConfirm}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}
        >
          {mode === 'later'
            ? `Schedule for ${plural(recipients, 'recipient')}`
            : `Send now to ${plural(recipients, 'recipient')}`}
        </Button>
      </DialogActions>
    </>
  );
};

export default SendDialog;
