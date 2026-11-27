import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  CircularProgress,
  GlobalStyles,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { AlertCircle, CheckCircle2, Info, Mail } from 'lucide-react';
import { FellowshipTheme } from '../../fellowship/FellowshipTheme';
import { fellowshipLightTheme } from '../../fellowship/theme';

interface ShellProps {
  children: ReactNode;
  title?: string;
  /** Chromeless: just the form card, for the bitshala.org iframe. */
  embed?: boolean;
  theme?: 'dark' | 'light';
}

/**
 * Frame for the pages signed-out people reach from an email link or the
 * website. Dark like the rest of the app; the embed variant drops every bit
 * of page chrome and shows only the form card.
 */
export const PublicShell = ({
  children,
  title,
  embed = false,
  theme = 'dark',
}: ShellProps) => {
  if (embed) {
    return (
      <FellowshipTheme
        theme={theme === 'light' ? fellowshipLightTheme : undefined}
      >
        {/* The document has an inline black body background; only !important
            gets past it, and this is removed again when the embed unmounts. */}
        <GlobalStyles
          styles={{
            'html, body, #root': { background: 'transparent !important' },
          }}
        />
        {/* The page around the card is see-through, but the card is solid:
            the host page's background is unknown, and themed text straight
            on top of it (white on a light site) would be unreadable. */}
        <Box
          sx={{
            p: 2.5,
            borderRadius: 3,
            border: '1px solid',
            borderColor: theme === 'light' ? '#e4e4e7' : '#27272a',
            bgcolor: theme === 'light' ? '#ffffff' : '#19191d',
            color: 'text.primary',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {children}
        </Box>
      </FellowshipTheme>
    );
  }

  return (
    <FellowshipTheme baseline>
      <Box
        sx={{
          minHeight: '100vh',
          bgcolor: '#0e0e10',
          color: '#fafafa',
          fontFamily: 'Inter, sans-serif',
          px: { xs: 2, sm: 3 },
          py: { xs: 4, sm: 8 },
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 480 }}>
          <Stack
            direction="row"
            spacing={1.25}
            alignItems="center"
            sx={{ mb: 2.5 }}
          >
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'rgba(249,115,22,0.15)',
                border: '1px solid rgba(249,115,22,0.25)',
              }}
            >
              <Mail size={17} color="#fb923c" />
            </Box>
            <Typography sx={{ fontWeight: 700, letterSpacing: 0.2 }}>
              Bitshala
            </Typography>
          </Stack>
          <Box
            sx={{
              bgcolor: '#19191d',
              border: '1px solid #27272a',
              borderRadius: 3,
              p: { xs: 2.5, sm: 3.5 },
            }}
          >
            {title && (
              <Typography
                component="h1"
                sx={{
                  fontWeight: 700,
                  fontSize: { xs: '1.35rem', sm: '1.5rem' },
                  lineHeight: 1.25,
                  mb: 2,
                }}
              >
                {title}
              </Typography>
            )}
            {children}
          </Box>
        </Box>
      </Box>
    </FellowshipTheme>
  );
};

interface PanelProps {
  tone: 'loading' | 'success' | 'error' | 'info';
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}

const TONE_COLORS = {
  success: '#4ade80',
  error: '#f87171',
  info: '#60a5fa',
};

/** A centred message with an icon: loading, done, failed or informational. */
export const StatePanel = ({ tone, title, children, actions }: PanelProps) => {
  const color = tone === 'loading' ? '#fb923c' : TONE_COLORS[tone];
  const Icon =
    tone === 'success' ? CheckCircle2 : tone === 'error' ? AlertCircle : Info;

  return (
    <Box
      sx={{ textAlign: 'center', py: 1 }}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.5 }}>
        {tone === 'loading' ? (
          <CircularProgress size={34} sx={{ color }} />
        ) : (
          <Icon size={36} color={color} />
        )}
      </Box>
      <Typography
        component="h1"
        sx={{ fontWeight: 700, fontSize: '1.25rem', mb: children ? 1 : 0 }}
      >
        {title}
      </Typography>
      {children && (
        <Box sx={{ color: 'text.secondary', fontSize: '0.92rem' }}>
          {children}
        </Box>
      )}
      {actions && <Box sx={{ mt: 2.5 }}>{actions}</Box>}
    </Box>
  );
};

/** An in-app link in the page's orange accent. */
export const AccentLink = ({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) => (
  <Link
    component={RouterLink}
    to={to}
    underline="hover"
    sx={{ color: '#fb923c', fontWeight: 600 }}
  >
    {children}
  </Link>
);
