import { useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { Monitor, Smartphone } from 'lucide-react';

type Device = 'desktop' | 'mobile';

const MOBILE_WIDTH = 375;

interface Props {
  subject: string | null;
  preheader?: string | null;
  html: string | null;
  loading?: boolean;
  error?: string | null;
  height?: number | string;
}

/**
 * Shows the server-rendered email. The iframe is fully sandboxed (no scripts,
 * no same-origin), so admin-written HTML cannot reach the portal's session.
 */
const EmailPreview = ({
  subject,
  preheader,
  html,
  loading = false,
  error = null,
  height = 640,
}: Props) => {
  const [device, setDevice] = useState<Device>('desktop');

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1.5}
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: '0.66rem',
              letterSpacing: 0.8,
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'text.secondary',
            }}
          >
            Preview
          </Typography>
          <Typography
            title={subject ?? undefined}
            sx={{
              fontWeight: 700,
              fontSize: '0.92rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subject || '—'}
          </Typography>
          {preheader && (
            <Typography
              title={preheader}
              sx={{
                fontSize: '0.78rem',
                color: 'text.secondary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {preheader}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {loading && <CircularProgress size={14} />}
          <ToggleButtonGroup
            size="small"
            exclusive
            value={device}
            onChange={(_, next: Device | null) => next && setDevice(next)}
            aria-label="Preview width"
          >
            <ToggleButton value="desktop" aria-label="Desktop width">
              <Monitor size={14} />
            </ToggleButton>
            <ToggleButton value="mobile" aria-label="Mobile width">
              <Smartphone size={14} />
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ borderRadius: 0 }}>
          Couldn't render the preview: {error}
        </Alert>
      )}
      <Box
        sx={{
          bgcolor: '#0b0b0d',
          display: 'flex',
          justifyContent: 'center',
          p: device === 'mobile' ? 2 : 0,
        }}
      >
        {html !== null ? (
          <Box
            component="iframe"
            title="Email preview"
            sandbox=""
            srcDoc={html}
            sx={{
              display: 'block',
              border: 0,
              width: device === 'mobile' ? MOBILE_WIDTH : '100%',
              maxWidth: '100%',
              height,
              bgcolor: '#ffffff',
              borderRadius: device === 'mobile' ? 2 : 0,
              boxShadow:
                device === 'mobile' ? '0 0 0 1px rgba(255,255,255,0.08)' : 0,
            }}
          />
        ) : (
          <Box
            sx={{
              height,
              display: 'grid',
              placeItems: 'center',
              color: 'text.secondary',
              fontSize: '0.85rem',
            }}
          >
            {loading ? <CircularProgress size={22} /> : 'Nothing to preview.'}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default EmailPreview;
