import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Search } from 'lucide-react';
import {
  NewsletterDeliveryStatus,
  type NewsletterDeliveryResponse,
} from '@nonce/shared';
import { useNewsletterDeliveries } from '../../../hooks/newsletterHooks';
import { useDebounce } from '../../../hooks/useDebounce';
import { formatDateTime } from '../../../utils/dateUtils';
import { isBadFilterError } from '../../../utils/errorUtils';
import { fontFamilyMono } from '../../fellowship/theme';
import FilterPills from '../shared/FilterPills';
import { NewsletterStatusChip } from '../shared/StatusChips';
import TablePager from '../shared/TablePager';
import { apiErrorMessage } from '../shared/newsletterUtils';
import { headCellSx, monoSx, tableFrameSx } from '../shared/tableStyles';
import { usePaging } from '../shared/usePaging';

const LIVE_REFRESH_MS = 5000;

type StatusFilter = NewsletterDeliveryStatus | 'ALL';

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Sent', value: NewsletterDeliveryStatus.SENT },
  { label: 'Pending', value: NewsletterDeliveryStatus.PENDING },
  { label: 'Sending', value: NewsletterDeliveryStatus.SENDING },
  { label: 'Failed', value: NewsletterDeliveryStatus.FAILED },
  { label: 'Skipped', value: NewsletterDeliveryStatus.SKIPPED },
];

const cellSx = { py: 1.25, px: 2 };

interface Props {
  newsletterId: string;
  trackingEnabled: boolean;
  /** Refresh on a timer while the newsletter is sending. */
  live: boolean;
}

const DeliveriesTable = ({ newsletterId, trackingEnabled, live }: Props) => {
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search.trim(), 300);
  const { page, pageSize, setPage, setPageSize } = usePaging(
    `${debouncedSearch}|${status}`
  );

  const { data, isLoading, isError, error } = useNewsletterDeliveries(
    {
      newsletterId,
      query: {
        page,
        pageSize,
        ...(status !== 'ALL' ? { status } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      },
    },
    {
      placeholderData: previous => previous,
      refetchInterval: live ? LIVE_REFRESH_MS : false,
    }
  );

  const records = useMemo(() => data?.records ?? [], [data?.records]);
  const total = data?.totalRecords ?? 0;
  const columnCount = trackingEnabled ? 7 : 5;
  const filtered = status !== 'ALL' || !!debouncedSearch;

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        sx={{ mb: 1.5 }}
      >
        <FilterPills<StatusFilter>
          options={STATUS_FILTERS}
          value={status}
          onChange={setStatus}
        />
        <TextField
          size="small"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search email or name…"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={14} />
                </InputAdornment>
              ),
            },
            htmlInput: { maxLength: 100, 'aria-label': 'Search deliveries' },
          }}
          sx={{ width: { md: 300 } }}
        />
      </Stack>

      {isError && (
        <Alert
          severity={isBadFilterError(error) ? 'warning' : 'error'}
          sx={{ mb: 1.5 }}
        >
          Couldn't load deliveries: {apiErrorMessage(error)}
        </Alert>
      )}

      <Box sx={tableFrameSx}>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: trackingEnabled ? 900 : 720 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={headCellSx}>Email</TableCell>
                <TableCell sx={headCellSx}>Name</TableCell>
                <TableCell sx={headCellSx}>Status</TableCell>
                <TableCell sx={headCellSx}>Error</TableCell>
                <TableCell sx={headCellSx}>Sent</TableCell>
                {trackingEnabled && (
                  <>
                    <TableCell sx={headCellSx}>Opened</TableCell>
                    <TableCell sx={{ ...headCellSx, textAlign: 'right' }}>
                      Clicks
                    </TableCell>
                  </>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={columnCount} sx={{ border: 'none' }}>
                    <Box
                      sx={{ display: 'flex', justifyContent: 'center', py: 5 }}
                    >
                      <CircularProgress size={22} />
                    </Box>
                  </TableCell>
                </TableRow>
              ) : records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} sx={{ border: 'none' }}>
                    <Typography
                      variant="body2"
                      sx={{
                        color: 'text.secondary',
                        textAlign: 'center',
                        py: 5,
                      }}
                    >
                      {filtered
                        ? 'No deliveries match these filters.'
                        : 'No deliveries yet. The recipient list is built when sending starts.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                records.map(delivery => (
                  <DeliveryRow
                    key={delivery.id}
                    delivery={delivery}
                    trackingEnabled={trackingEnabled}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {!isLoading && total > 0 && (
          <TablePager
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </Box>
    </Box>
  );
};

const DeliveryRow = ({
  delivery,
  trackingEnabled,
}: {
  delivery: NewsletterDeliveryResponse;
  trackingEnabled: boolean;
}) => (
  <TableRow sx={{ '&:last-child td': { borderBottom: 'none' } }}>
    <TableCell sx={{ ...cellSx, maxWidth: 260 }}>
      <Typography
        title={delivery.email}
        sx={{
          fontFamily: fontFamilyMono,
          fontSize: '0.8rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {delivery.email}
      </Typography>
    </TableCell>
    <TableCell sx={{ ...cellSx, maxWidth: 180 }}>
      <Typography
        title={delivery.name ?? undefined}
        sx={{
          fontSize: '0.82rem',
          color: delivery.name ? 'text.primary' : 'text.secondary',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {delivery.name ?? '—'}
      </Typography>
    </TableCell>
    <TableCell sx={cellSx}>
      <NewsletterStatusChip status={delivery.status} />
    </TableCell>
    <TableCell sx={{ ...cellSx, maxWidth: 280 }}>
      <Typography
        title={delivery.error ?? undefined}
        sx={{
          fontSize: '0.78rem',
          color:
            delivery.status === NewsletterDeliveryStatus.FAILED
              ? 'error.main'
              : 'text.secondary',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {delivery.error ?? '—'}
        {delivery.attempts > 1 && ` (${delivery.attempts} attempts)`}
      </Typography>
    </TableCell>
    <TableCell sx={cellSx}>
      <Typography sx={monoSx}>{formatDateTime(delivery.sentAt)}</Typography>
    </TableCell>
    {trackingEnabled && (
      <>
        <TableCell sx={cellSx}>
          <Typography sx={monoSx}>
            {delivery.openedAt ? formatDateTime(delivery.openedAt) : '—'}
            {delivery.openCount > 1 && ` ×${delivery.openCount}`}
          </Typography>
        </TableCell>
        <TableCell sx={{ ...cellSx, textAlign: 'right' }}>
          <Typography sx={monoSx}>
            {delivery.clickCount > 0 ? delivery.clickCount : '—'}
          </Typography>
        </TableCell>
      </>
    )}
  </TableRow>
);

export default DeliveriesTable;
