import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { Check, Copy, ExternalLink } from 'lucide-react';
import type { MailingListResponse } from '@nonce/shared';
import { fontFamilyMono } from '../../fellowship/theme';
import { buildFetchSnippet, buildIframeSnippet } from './embedSnippets';

const CopyableCode = ({ label, code }: { label: string; code: string }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (insecure context, iframe policy); the
      // snippet is still selectable in the box below.
    }
  };

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 0.5 }}
      >
        <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>
          {label}
        </Typography>
        <Tooltip title={copied ? 'Copied' : 'Copy to clipboard'}>
          <IconButton
            size="small"
            aria-label={`Copy ${label}`}
            onClick={copy}
            sx={{ color: copied ? 'success.main' : 'text.secondary' }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </IconButton>
        </Tooltip>
      </Stack>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          maxHeight: 240,
          overflow: 'auto',
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#0e0e10',
          color: '#d4d4d8',
          fontFamily: fontFamilyMono,
          fontSize: '0.72rem',
          lineHeight: 1.6,
          whiteSpace: 'pre',
        }}
      >
        {code}
      </Box>
    </Box>
  );
};

/** Mount it while it should be open. */
const EmbedDialog = ({
  list,
  onClose,
}: {
  list: MailingListResponse;
  onClose: () => void;
}) => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const origin = window.location.origin;
  const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? '');
  const previewUrl = `${origin}/embed/newsletter?lists=${encodeURIComponent(list.slug)}${
    theme === 'light' ? '&theme=light' : ''
  }`;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700 }}>
        Embed the sign-up form for {list.name}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 0.5 }}>
          <Typography sx={{ color: 'text.secondary', fontSize: '0.88rem' }}>
            People who sign up get a confirmation email first, and are only
            added to the list once they click the link in it.
          </Typography>

          <Stack spacing={1.5}>
            <CopyableCode
              label="Option 1 — iframe"
              code={buildIframeSnippet(origin, list.slug, theme)}
            />
            <Stack
              direction="row"
              spacing={2}
              alignItems="center"
              flexWrap="wrap"
              sx={{ rowGap: 1 }}
            >
              <ToggleButtonGroup
                size="small"
                exclusive
                value={theme}
                onChange={(_, next) => next && setTheme(next)}
                aria-label="Embed theme"
              >
                <ToggleButton value="dark" sx={{ px: 1.5, py: 0.25 }}>
                  Dark
                </ToggleButton>
                <ToggleButton value="light" sx={{ px: 1.5, py: 0.25 }}>
                  Light
                </ToggleButton>
              </ToggleButtonGroup>
              <Button
                size="small"
                component="a"
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                endIcon={<ExternalLink size={13} />}
                sx={{ color: 'primary.light' }}
              >
                Open the embedded form
              </Button>
            </Stack>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }}>
              The page is transparent, so it takes on the background of the site
              it sits on.
            </Typography>
          </Stack>

          <Stack spacing={1}>
            <CopyableCode
              label="Option 2 — your own HTML form"
              code={buildFetchSnippet(apiBaseUrl, list.slug)}
            />
            <Typography sx={{ color: 'text.secondary', fontSize: '0.78rem' }}>
              No dependencies. Style it however you like, but keep the hidden{' '}
              <code>website</code> field: it is how the API recognises bots.
            </Typography>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EmbedDialog;
