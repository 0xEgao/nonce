import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Upload } from 'lucide-react';
import type { AddSubscribersResponse } from '@nonce/shared';
import { useAddMailingListSubscribers } from '../../../hooks/newsletterHooks';
import { extractErrorMessage } from '../../../utils/errorUtils';
import { fontFamilyMono } from '../../fellowship/theme';
import AddSubscribersCounts from './AddSubscribersCounts';
import {
  MAX_IMPORT_SUBSCRIBERS,
  csvToSubscriberLines,
  parseSubscriberText,
} from './subscriberImport';

// Far more than 5,000 addresses of text; stops a wrong file (a video, say)
// from being read into the browser.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface Props {
  listId: string;
  listName: string;
  onClose: () => void;
}

/** Mount it while it should be open; unmounting resets it. */
const AddSubscribersDialog = ({ listId, listName, onClose }: Props) => {
  const [text, setText] = useState('');
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [resubscribe, setResubscribe] = useState(false);
  const [result, setResult] = useState<AddSubscribersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const addSubscribers = useAddMailingListSubscribers();
  const pending = addSubscribers.isPending;

  const parsed = useMemo(() => parseSubscriberText(text), [text]);
  const tooMany = parsed.entries.length > MAX_IMPORT_SUBSCRIBERS;
  const canSubmit = parsed.entries.length > 0 && !tooMany && !pending;

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still fires a change event.
    event.target.value = '';
    if (!file) return;
    setFileNote(null);
    setFileError(null);
    if (file.size > MAX_FILE_BYTES) {
      setFileError('That file is too large. Keep it under 5 MB.');
      return;
    }
    try {
      const { lines, usedHeader } = csvToSubscriberLines(await file.text());
      if (lines.length === 0) {
        setFileError(`No addresses found in ${file.name}.`);
        return;
      }
      setText(current =>
        current.trim()
          ? `${current.trimEnd()}\n${lines.join('\n')}`
          : lines.join('\n')
      );
      setFileNote(
        `Added ${lines.length.toLocaleString()} rows from ${file.name}, reading ${
          usedHeader ? 'its "email" column' : 'the first column'
        }.`
      );
    } catch {
      setFileError('Could not read that file.');
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    try {
      setResult(
        await addSubscribers.mutateAsync({
          listId,
          body: { subscribers: parsed.entries, resubscribe },
        })
      );
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  };

  const reset = () => {
    setText('');
    setFileNote(null);
    setFileError(null);
    setResult(null);
    setError(null);
  };

  return (
    <Dialog
      open
      onClose={pending ? undefined : onClose}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle sx={{ fontWeight: 700 }}>
        Add subscribers to {listName}
      </DialogTitle>
      <DialogContent>
        {result ? (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <AddSubscribersCounts result={result} resubscribe={resubscribe} />
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
              They are subscribed straight away, with no confirmation email, so
              only add people who have agreed to hear from you.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              multiline
              minRows={6}
              maxRows={12}
              fullWidth
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder={
                'alice@example.com\nBob Smith <bob@example.com>\ncarol@example.com, Carol'
              }
              label="Paste addresses"
              helperText="One per line: email, email,name or Name <email>."
              slotProps={{
                htmlInput: { spellCheck: false },
                input: {
                  sx: { fontFamily: fontFamilyMono, fontSize: '0.8rem' },
                },
              }}
            />
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              sx={{ rowGap: 1 }}
            >
              <Button
                variant="outlined"
                size="small"
                startIcon={<Upload size={14} />}
                onClick={() => fileInput.current?.click()}
                sx={{ color: 'text.primary', borderColor: 'divider' }}
              >
                Choose a .csv file
              </Button>
              {text && (
                <Button
                  size="small"
                  onClick={reset}
                  sx={{ color: 'text.secondary' }}
                >
                  Clear
                </Button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                hidden
                onChange={readFile}
              />
            </Stack>
            {fileError && <Alert severity="warning">{fileError}</Alert>}
            {fileNote && (
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                {fileNote}
              </Typography>
            )}

            {text.trim() && (
              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  px: 2,
                  py: 1.25,
                }}
              >
                <Stack
                  direction="row"
                  spacing={2}
                  flexWrap="wrap"
                  sx={{ rowGap: 0.5, fontSize: '0.85rem' }}
                >
                  <Typography
                    component="span"
                    sx={{ fontSize: 'inherit', color: 'success.main' }}
                  >
                    {parsed.entries.length.toLocaleString()} valid
                  </Typography>
                  <Typography
                    component="span"
                    sx={{
                      fontSize: 'inherit',
                      color: parsed.invalid.length
                        ? 'error.main'
                        : 'text.secondary',
                    }}
                  >
                    {parsed.invalid.length.toLocaleString()} invalid
                  </Typography>
                  {parsed.duplicates > 0 && (
                    <Typography
                      component="span"
                      sx={{ fontSize: 'inherit', color: 'text.secondary' }}
                    >
                      {parsed.duplicates.toLocaleString()} duplicate
                      {parsed.duplicates === 1 ? '' : 's'} ignored
                    </Typography>
                  )}
                </Stack>
                {parsed.invalid.length > 0 && (
                  <Typography
                    sx={{
                      mt: 0.75,
                      fontFamily: fontFamilyMono,
                      fontSize: '0.72rem',
                      color: 'text.secondary',
                      wordBreak: 'break-all',
                    }}
                  >
                    Skipped: {parsed.invalid.slice(0, 5).join(' · ')}
                    {parsed.invalid.length > 5 &&
                      ` and ${parsed.invalid.length - 5} more`}
                  </Typography>
                )}
                {tooMany && (
                  <Alert severity="error" sx={{ mt: 1.25 }}>
                    At most {MAX_IMPORT_SUBSCRIBERS.toLocaleString()} addresses
                    per upload. Split the list into batches.
                  </Alert>
                )}
              </Box>
            )}

            <div>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={resubscribe}
                    onChange={event => setResubscribe(event.target.checked)}
                  />
                }
                label="Also re-subscribe people who previously unsubscribed"
              />
              <Typography
                sx={{ color: 'text.secondary', fontSize: '0.75rem', ml: 4 }}
              >
                Covers addresses that left this list, or were marked
                unsubscribed or bounced. Leave it off unless they asked to come
                back.
              </Typography>
            </div>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {result ? (
          <>
            <Button onClick={reset} sx={{ color: 'text.secondary' }}>
              Add more
            </Button>
            <Button variant="contained" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={onClose}
              disabled={pending}
              sx={{ color: 'text.secondary' }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={submit}
              disabled={!canSubmit}
              startIcon={
                pending ? (
                  <CircularProgress size={14} color="inherit" />
                ) : undefined
              }
            >
              {parsed.entries.length > 0
                ? `Add ${parsed.entries.length.toLocaleString()} ${
                    parsed.entries.length === 1 ? 'person' : 'people'
                  }`
                : 'Add people'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default AddSubscribersDialog;
