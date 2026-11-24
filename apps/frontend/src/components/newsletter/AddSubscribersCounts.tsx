import { Box, Stack, Typography } from '@mui/material';
import type { AddSubscribersResponse } from '@nonce/shared';
import { fontFamilyMono } from '../fellowship/theme';

const Row = ({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) => (
  <Stack
    direction="row"
    justifyContent="space-between"
    alignItems="baseline"
    sx={{ py: 0.5 }}
  >
    <Typography
      sx={{
        fontSize: '0.85rem',
        color: strong ? 'text.primary' : 'text.secondary',
        fontWeight: strong ? 600 : 400,
      }}
    >
      {label}
    </Typography>
    <Typography
      sx={{
        fontFamily: fontFamilyMono,
        fontSize: '0.88rem',
        fontWeight: strong ? 700 : 500,
        color: strong && value > 0 ? 'success.main' : 'text.primary',
      }}
    >
      {value.toLocaleString()}
    </Typography>
  </Stack>
);

interface Props {
  result: AddSubscribersResponse;
  /** Counts from a dry run: nothing has been written yet. */
  dryRun?: boolean;
  /** Whether the request asked to re-subscribe people who had left. */
  resubscribe: boolean;
}

/** The outcome of adding addresses to a list, whether previewed or done. */
const AddSubscribersCounts = ({
  result,
  dryRun = false,
  resubscribe,
}: Props) => {
  const skipped = result.skippedUnsubscribed + result.skippedSuppressed;

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.5,
        px: 2,
        py: 1,
      }}
    >
      <Row
        label={dryRun ? 'Would be added' : 'Added'}
        value={result.added}
        strong
      />
      <Row label="Already subscribed" value={result.alreadySubscribed} />
      <Row
        label="Skipped: unsubscribed from this list"
        value={result.skippedUnsubscribed}
      />
      <Row
        label="Skipped: unsubscribed or bounced overall"
        value={result.skippedSuppressed}
      />
      {result.invalid.length > 0 && (
        <>
          <Row label="Invalid addresses" value={result.invalid.length} />
          <Typography
            sx={{
              fontFamily: fontFamilyMono,
              fontSize: '0.72rem',
              color: 'text.secondary',
              wordBreak: 'break-all',
              pb: 0.5,
            }}
          >
            {result.invalid.slice(0, 5).join(', ')}
            {result.invalid.length > 5 &&
              ` and ${result.invalid.length - 5} more`}
          </Typography>
        </>
      )}
      {skipped > 0 && !resubscribe && (
        <Typography
          sx={{
            fontSize: '0.75rem',
            color: 'text.secondary',
            pt: 0.5,
            pb: 0.5,
          }}
        >
          People who unsubscribed or bounced are left alone. Tick the
          re-subscribe option to add them anyway.
        </Typography>
      )}
    </Box>
  );
};

export default AddSubscribersCounts;
