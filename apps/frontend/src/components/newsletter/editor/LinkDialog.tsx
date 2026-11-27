import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

export interface LinkDraft {
  /** Changes on every open, so the form starts from this draft. */
  key: number;
  href: string;
  text: string;
  button: boolean;
  /** Only asked for when there is no selection and no link to edit. */
  askText: boolean;
  /** An existing link is under the cursor. */
  editing: boolean;
}

export interface LinkResult {
  href: string;
  text: string;
  button: boolean;
}

const MERGE_TAG_PATTERN = /^\{\{\s*[a-z_]+\s*\}\}$/i;

/**
 * Email links have to be absolute, so a bare domain gets https:// and a bare
 * address gets mailto:. Merge tags such as {{preferences_url}} pass through;
 * the server swaps them for the real URL.
 */
const normalizeHref = (raw: string): { href: string; error?: string } => {
  const href = raw.trim();
  if (!href) return { href, error: 'Enter a URL.' };
  if (MERGE_TAG_PATTERN.test(href)) return { href };
  if (/^(https?|mailto|tel):/i.test(href)) return { href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return { href, error: 'Use an http(s), mailto: or tel: link.' };
  }
  if (href.startsWith('/') || href.startsWith('#')) {
    return { href, error: 'Links in an email need a full URL.' };
  }
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(href)) {
    return { href: `mailto:${href}` };
  }
  return { href: `https://${href}` };
};

interface Props {
  open: boolean;
  draft: LinkDraft | null;
  onClose: () => void;
  onSave: (result: LinkResult) => void;
  onRemove: () => void;
}

const LinkDialog = ({ open, draft, onClose, onSave, onRemove }: Props) => (
  <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
    {draft && (
      <LinkForm
        key={draft.key}
        draft={draft}
        onClose={onClose}
        onSave={onSave}
        onRemove={onRemove}
      />
    )}
  </Dialog>
);

const LinkForm = ({
  draft,
  onClose,
  onSave,
  onRemove,
}: Omit<Props, 'open' | 'draft'> & { draft: LinkDraft }) => {
  const [href, setHref] = useState(draft.href);
  const [text, setText] = useState(draft.text);
  const [button, setButton] = useState(draft.button);
  const [error, setError] = useState<string | null>(null);

  const missingLabel = draft.askText && button && !text.trim();

  const submit = () => {
    const normalized = normalizeHref(href);
    if (normalized.error) {
      setError(normalized.error);
      return;
    }
    if (missingLabel) return;
    onSave({ href: normalized.href, text: text.trim(), button });
  };

  const title = draft.editing
    ? draft.button
      ? 'Edit button'
      : 'Edit link'
    : button
      ? 'Add button'
      : 'Add link';

  return (
    <Box
      component="form"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {draft.askText && (
            <TextField
              label={button ? 'Button label' : 'Text to show'}
              size="small"
              fullWidth
              value={text}
              onChange={e => setText(e.target.value)}
              autoFocus
              required={button}
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
          )}
          <TextField
            label="URL"
            size="small"
            fullWidth
            value={href}
            onChange={e => {
              setHref(e.target.value);
              setError(null);
            }}
            autoFocus={!draft.askText}
            error={!!error}
            helperText={
              error ??
              'A web address, an email address, or a merge tag such as {{preferences_url}}.'
            }
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={button}
                  onChange={e => setButton(e.target.checked)}
                />
              }
              label="Show as a button"
            />
            <Typography
              variant="caption"
              component="p"
              sx={{ color: 'text.secondary', ml: 0.5 }}
            >
              A highlighted call to action. Reads best centered, on its own
              line.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Box>
          {draft.editing && (
            <Button color="error" onClick={onRemove}>
              Remove link
            </Button>
          )}
        </Box>
        <Box>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!href.trim() || missingLabel}
          >
            {draft.editing ? 'Save' : 'Insert'}
          </Button>
        </Box>
      </DialogActions>
    </Box>
  );
};

export default LinkDialog;
