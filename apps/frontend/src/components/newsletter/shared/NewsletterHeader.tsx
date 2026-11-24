import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import {
  NewsletterStatus,
  type NewsletterSummaryResponse,
} from '@nonce/shared';
import NewsletterStatusChip from './NewsletterStatusChip';
import { isPausedNow } from '../composer/newsletterUtils';

/** Status, subject and the page's actions, for the read-only views. */
const NewsletterHeader = ({
  newsletter,
  actions,
}: {
  newsletter: NewsletterSummaryResponse;
  actions?: ReactNode;
}) => {
  const paused =
    newsletter.status === NewsletterStatus.SENDING &&
    isPausedNow(newsletter.pausedUntil);

  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={1.5}
      alignItems={{ xs: 'stretch', md: 'center' }}
      justifyContent="space-between"
      sx={{ mb: 3 }}
    >
      <Stack
        direction="row"
        spacing={1.25}
        alignItems="center"
        sx={{ minWidth: 0 }}
      >
        <NewsletterStatusChip
          status={newsletter.status}
          label={paused ? 'Paused' : undefined}
        />
        <Typography
          variant="h6"
          title={newsletter.subject}
          sx={{
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {newsletter.subject}
        </Typography>
      </Stack>
      {actions && (
        <Stack
          direction="row"
          spacing={1}
          flexWrap="wrap"
          sx={{ rowGap: 1, flexShrink: 0 }}
        >
          {actions}
        </Stack>
      )}
    </Stack>
  );
};

export const DetailRow = ({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) => (
  <Box
    sx={{
      display: 'grid',
      gridTemplateColumns: '96px minmax(0, 1fr)',
      columnGap: 1.5,
      alignItems: 'baseline',
    }}
  >
    <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
      {label}
    </Typography>
    <Typography sx={{ fontSize: '0.85rem', overflowWrap: 'anywhere' }}>
      {value}
    </Typography>
  </Box>
);

export default NewsletterHeader;
