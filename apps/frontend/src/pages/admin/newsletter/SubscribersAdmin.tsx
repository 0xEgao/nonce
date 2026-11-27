import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { MoreVertical, Search } from 'lucide-react';
import { SubscriberStatus, type SubscriberResponse } from '@nonce/shared';
import FellowshipPageLayout from '../../../components/fellowship/FellowshipPageLayout';
import { fontFamilyMono } from '../../../components/fellowship/theme';
import ConfirmDialog from '../../../components/newsletter/shared/ConfirmDialog';
import FilterPills from '../../../components/newsletter/shared/FilterPills';
import NewsletterAdminTabs from '../../../components/newsletter/shared/NewsletterAdminTabs';
import { SubscriberStatusChip } from '../../../components/newsletter/shared/StatusChips';
import TablePager from '../../../components/newsletter/shared/TablePager';
import ToastSnackbar from '../../../components/newsletter/shared/ToastSnackbar';
import { plural } from '../../../components/newsletter/shared/newsletterUtils';
import {
  monoSx,
  tableFrameSx,
} from '../../../components/newsletter/shared/tableStyles';
import { usePaging } from '../../../components/newsletter/shared/usePaging';
import { useToast } from '../../../components/newsletter/shared/useToast';
import { formatCohortDate } from '../../../helpers/cohortHelpers';
import {
  useDeleteSubscriber,
  useSubscribers,
  useUpdateSubscriber,
} from '../../../hooks/newsletterHooks';
import { useDebounce } from '../../../hooks/useDebounce';
import {
  extractErrorMessage,
  isBadFilterError,
} from '../../../utils/errorUtils';

type StatusFilter = 'ALL' | SubscriberStatus;

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Active', value: SubscriberStatus.ACTIVE },
  { label: 'Unsubscribed', value: SubscriberStatus.UNSUBSCRIBED },
  { label: 'Bounced', value: SubscriberStatus.BOUNCED },
];

const STATUS_ACTIONS: { status: SubscriberStatus; label: string }[] = [
  { status: SubscriberStatus.ACTIVE, label: 'Reactivate' },
  { status: SubscriberStatus.UNSUBSCRIBED, label: 'Mark unsubscribed' },
  { status: SubscriberStatus.BOUNCED, label: 'Mark bounced' },
];

const SubscribersAdmin = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    subscriber: SubscriberResponse;
  } | null>(null);
  const [reactivating, setReactivating] = useState<SubscriberResponse | null>(
    null
  );
  const [deleting, setDeleting] = useState<SubscriberResponse | null>(null);
  const { toast, show, close } = useToast();

  const debouncedSearch = useDebounce(search.trim(), 300);
  const { page, pageSize, setPage, setPageSize } = usePaging(
    `${debouncedSearch}|${status}`
  );

  const { data, isLoading, isError, error, refetch } = useSubscribers(
    {
      page,
      pageSize,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(status !== 'ALL' ? { status } : {}),
    },
    { placeholderData: previous => previous }
  );
  const rows = data?.records ?? [];
  const total = data?.totalRecords ?? 0;

  const updateSubscriber = useUpdateSubscriber();
  const deleteSubscriber = useDeleteSubscriber();

  // Deleting the last row of the last page leaves that page empty.
  useEffect(() => {
    if (page > 0 && data && rows.length === 0) {
      setPage(Math.max(0, Math.ceil(total / pageSize) - 1));
    }
  }, [page, data, rows.length, total, pageSize, setPage]);

  const changeStatus = async (
    subscriber: SubscriberResponse,
    next: SubscriberStatus
  ) => {
    await updateSubscriber.mutateAsync({
      id: subscriber.id,
      body: { status: next },
    });
  };

  const pick = async (next: SubscriberStatus) => {
    if (!menu) return;
    const { subscriber } = menu;
    setMenu(null);
    // Reactivating lifts an opt-out, so it asks first; the other two only
    // ever stop mail.
    if (next === SubscriberStatus.ACTIVE) {
      setReactivating(subscriber);
      return;
    }
    try {
      await changeStatus(subscriber, next);
      show(
        'success',
        `${subscriber.email} marked ${
          next === SubscriberStatus.BOUNCED ? 'bounced' : 'unsubscribed'
        }.`
      );
    } catch (e) {
      show('error', extractErrorMessage(e));
    }
  };

  return (
    <FellowshipPageLayout
      title="Newsletter"
      subtitle="Subscribers"
      badge="Admin"
      hideIcon
    >
      <NewsletterAdminTabs />

      {isError && (
        <Alert
          severity={isBadFilterError(error) ? 'warning' : 'error'}
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          {isBadFilterError(error)
            ? `Invalid search, please adjust and try again. (${extractErrorMessage(error)})`
            : `Couldn't load subscribers: ${extractErrorMessage(error)}`}
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        sx={{ mb: 2 }}
      >
        <FilterPills<StatusFilter>
          options={STATUS_FILTERS}
          value={status}
          onChange={setStatus}
        />
        <TextField
          size="small"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search email or name…"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={14} />
                </InputAdornment>
              ),
            },
            htmlInput: { maxLength: 100, 'aria-label': 'Search subscribers' },
          }}
          sx={{ width: { xs: '100%', md: 320 } }}
        />
      </Stack>

      <TableContainer sx={tableFrameSx}>
        <Table size="small" sx={{ minWidth: 820 }}>
          <TableHead>
            <TableRow>
              <TableCell>Email</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Reason</TableCell>
              <TableCell align="right">Lists</TableCell>
              <TableCell>Added</TableCell>
              <TableCell align="right" sx={{ width: 56 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={22} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {debouncedSearch || status !== 'ALL'
                      ? 'No subscribers match your filters.'
                      : 'No subscribers yet. They appear here once someone signs up or you add them to a list.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map(row => (
                <TableRow
                  key={row.id}
                  hover
                  sx={{ '&:last-child td': { borderBottom: 0 } }}
                >
                  <TableCell sx={{ fontSize: '0.84rem' }}>
                    {row.email}
                  </TableCell>
                  <TableCell
                    sx={{
                      fontSize: '0.84rem',
                      color: row.name ? 'text.primary' : 'text.secondary',
                    }}
                  >
                    {row.name ?? '—'}
                  </TableCell>
                  <TableCell>
                    <SubscriberStatusChip status={row.status} />
                  </TableCell>
                  <TableCell
                    sx={{
                      maxWidth: 260,
                      fontSize: '0.78rem',
                      color: 'text.secondary',
                    }}
                  >
                    {row.statusReason ? (
                      <Tooltip title={row.statusReason}>
                        <Box
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.statusReason}
                        </Box>
                      </Tooltip>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{ fontFamily: fontFamilyMono, fontSize: '0.82rem' }}
                  >
                    {row.listCount.toLocaleString()}
                  </TableCell>
                  <TableCell sx={monoSx}>
                    {formatCohortDate(row.createdAt)}
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      aria-label={`Actions for ${row.email}`}
                      onClick={event =>
                        setMenu({
                          anchor: event.currentTarget,
                          subscriber: row,
                        })
                      }
                      sx={{ color: 'text.secondary' }}
                    >
                      <MoreVertical size={16} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {total > 0 && (
          <TablePager
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </TableContainer>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {STATUS_ACTIONS.filter(
          action => action.status !== menu?.subscriber.status
        ).map(action => (
          <MenuItem key={action.status} onClick={() => pick(action.status)}>
            <ListItemText
              slotProps={{ primary: { sx: { fontSize: '0.85rem' } } }}
            >
              {action.label}
            </ListItemText>
          </MenuItem>
        ))}
        <Divider />
        <MenuItem
          onClick={() => {
            setDeleting(menu?.subscriber ?? null);
            setMenu(null);
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemText
            slotProps={{ primary: { sx: { fontSize: '0.85rem' } } }}
          >
            Delete…
          </ListItemText>
        </MenuItem>
      </Menu>

      {reactivating && (
        <ConfirmDialog
          title="Reactivate this address?"
          confirmLabel="Reactivate"
          onClose={() => setReactivating(null)}
          onConfirm={async () => {
            await changeStatus(reactivating, SubscriberStatus.ACTIVE);
            show('success', `${reactivating.email} reactivated.`);
          }}
        >
          <Box component="p" sx={{ mt: 0, mb: 0 }}>
            <strong>{reactivating.email}</strong> is currently{' '}
            {reactivating.status === SubscriberStatus.BOUNCED
              ? 'marked as bounced'
              : 'unsubscribed'}
            , so no newsletter reaches them. Only reactivate the address if you
            know it works, or the person asked to receive emails again.
          </Box>
        </ConfirmDialog>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this subscriber?"
          confirmLabel="Delete"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteSubscriber.mutateAsync({ id: deleting.id });
            show('success', `Deleted ${deleting.email}.`);
          }}
        >
          <Box component="p" sx={{ mt: 0 }}>
            This deletes <strong>{deleting.email}</strong> and their
            subscriptions on every list
            {deleting.listCount > 0 &&
              ` (${plural(deleting.listCount, 'list')})`}
            . It cannot be undone.
          </Box>
          <Box component="p" sx={{ mb: 0 }}>
            Past newsletter reports still show this address and name. If they
            sign up again later they start from scratch, so any past unsubscribe
            or bounce is forgotten.
          </Box>
        </ConfirmDialog>
      )}

      <ToastSnackbar toast={toast} onClose={close} />
    </FellowshipPageLayout>
  );
};

export default SubscribersAdmin;
