import { useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
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
import {
  ArrowLeft,
  Code2,
  Download,
  Pencil,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  SubscriberStatus,
  SubscriptionStatus,
  type ListSubscriberResponse,
  type MailingListResponse,
} from '@nonce/shared';
import FellowshipPageLayout from '../../../components/fellowship/FellowshipPageLayout';
import { fontFamilyMono } from '../../../components/fellowship/theme';
import AddPortalUsersDialog from '../../../components/newsletter/AddPortalUsersDialog';
import AddSubscribersDialog from '../../../components/newsletter/AddSubscribersDialog';
import ConfirmDialog from '../../../components/newsletter/ConfirmDialog';
import EmbedDialog from '../../../components/newsletter/EmbedDialog';
import FilterPills from '../../../components/newsletter/FilterPills';
import MailingListFormDialog from '../../../components/newsletter/MailingListFormDialog';
import NewsletterAdminTabs from '../../../components/newsletter/NewsletterAdminTabs';
import {
  ArchivedChip,
  ListVisibilityChip,
  SubscriberStatusChip,
  SubscriptionStatusChip,
} from '../../../components/newsletter/StatusChips';
import TablePager from '../../../components/newsletter/TablePager';
import ToastSnackbar from '../../../components/newsletter/ToastSnackbar';
import {
  SUBSCRIPTION_SOURCE_LABELS,
  downloadBlob,
} from '../../../components/newsletter/newsletterUtils';
import { usePaging } from '../../../components/newsletter/usePaging';
import { useToast } from '../../../components/newsletter/useToast';
import { formatCohortDate } from '../../../helpers/cohortHelpers';
import {
  useExportMailingListSubscribers,
  useMailingList,
  useMailingListSubscribers,
  useRemoveMailingListSubscription,
} from '../../../hooks/newsletterHooks';
import { useDebounce } from '../../../hooks/useDebounce';
import { extractErrorMessage, isAxiosError } from '../../../utils/errorUtils';

type StatusFilter = 'ALL' | SubscriptionStatus;
type DialogKind = 'edit' | 'embed' | 'add' | 'portal';

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Subscribed', value: SubscriptionStatus.SUBSCRIBED },
  { label: 'Pending', value: SubscriptionStatus.PENDING },
  { label: 'Unsubscribed', value: SubscriptionStatus.UNSUBSCRIBED },
];

const Stat = ({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) => (
  <Box
    sx={{
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1.5,
      bgcolor: 'background.paper',
      px: 2,
      py: 1.25,
      minWidth: 104,
    }}
  >
    <Typography
      sx={{
        fontSize: '0.66rem',
        letterSpacing: 0.8,
        fontWeight: 700,
        textTransform: 'uppercase',
        color: 'text.secondary',
      }}
    >
      {label}
    </Typography>
    <Typography
      sx={{
        fontFamily: fontFamilyMono,
        fontSize: '1.4rem',
        fontWeight: 700,
        color: color ?? 'text.primary',
      }}
    >
      {value.toLocaleString()}
    </Typography>
  </Box>
);

const OutlineButton = ({
  icon,
  onClick,
  disabled,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) => (
  <Button
    variant="outlined"
    startIcon={icon}
    onClick={onClick}
    disabled={disabled}
    sx={{ color: 'text.primary', borderColor: 'divider' }}
  >
    {children}
  </Button>
);

const MailingListDetail = () => {
  const { listId = '' } = useParams<{ listId: string }>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [removing, setRemoving] = useState<ListSubscriberResponse | null>(null);
  const { toast, show, close } = useToast();

  const debouncedSearch = useDebounce(search.trim(), 300);
  const { page, pageSize, setPage, setPageSize } = usePaging(
    `${debouncedSearch}|${status}`
  );

  const listQuery = useMailingList(listId, { enabled: !!listId });
  const list: MailingListResponse | undefined = listQuery.data;

  const subscribersQuery = useMailingListSubscribers(
    {
      listId,
      query: {
        page,
        pageSize,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(status !== 'ALL' ? { status } : {}),
      },
    },
    { enabled: !!listId, placeholderData: previous => previous }
  );
  const rows = subscribersQuery.data?.records ?? [];
  const total = subscribersQuery.data?.totalRecords ?? 0;

  const exportCsv = useExportMailingListSubscribers();
  const removeSubscription = useRemoveMailingListSubscription();

  // Removing the last row of the last page leaves that page empty.
  useEffect(() => {
    if (page > 0 && subscribersQuery.data && rows.length === 0) {
      setPage(Math.max(0, Math.ceil(total / pageSize) - 1));
    }
  }, [page, subscribersQuery.data, rows.length, total, pageSize, setPage]);

  const handleExport = async () => {
    if (!list) return;
    try {
      const blob = await exportCsv.mutateAsync({ listId });
      downloadBlob(blob, `${list.slug}-subscribers.csv`);
    } catch (e) {
      show('error', extractErrorMessage(e));
    }
  };

  if (listQuery.isLoading) {
    return (
      <FellowshipPageLayout
        title="Newsletter"
        subtitle="Mailing list"
        badge="Admin"
        hideIcon
      >
        <NewsletterAdminTabs />
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={24} />
        </Box>
      </FellowshipPageLayout>
    );
  }

  if (!list) {
    const notFound =
      isAxiosError(listQuery.error) && listQuery.error.response?.status === 404;
    return (
      <FellowshipPageLayout
        title="Newsletter"
        subtitle="Mailing list"
        badge="Admin"
        hideIcon
      >
        <NewsletterAdminTabs />
        <Alert
          severity={notFound ? 'warning' : 'error'}
          action={
            <Button
              component={RouterLink}
              to="/admin/newsletter/lists"
              color="inherit"
              size="small"
            >
              All lists
            </Button>
          }
        >
          {notFound
            ? 'This mailing list does not exist. It may have been deleted.'
            : `Couldn't load this mailing list: ${extractErrorMessage(listQuery.error)}`}
        </Alert>
      </FellowshipPageLayout>
    );
  }

  return (
    <FellowshipPageLayout
      title="Newsletter"
      subtitle="Mailing list"
      badge="Admin"
      hideIcon
    >
      <NewsletterAdminTabs />

      <Button
        component={RouterLink}
        to="/admin/newsletter/lists"
        size="small"
        startIcon={<ArrowLeft size={14} />}
        sx={{ color: 'text.secondary', mb: 1.5, ml: -1 }}
      >
        All lists
      </Button>

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1.25}
            alignItems="center"
            flexWrap="wrap"
            sx={{ rowGap: 0.5 }}
          >
            <Typography
              variant="h5"
              sx={{ fontWeight: 700, wordBreak: 'break-word' }}
            >
              {list.name}
            </Typography>
            <ListVisibilityChip isPublic={list.isPublic} />
            {list.archivedAt && <ArchivedChip />}
          </Stack>
          <Typography
            sx={{
              fontFamily: fontFamilyMono,
              fontSize: '0.78rem',
              color: 'text.secondary',
              mt: 0.5,
            }}
          >
            {list.slug}
          </Typography>
          {list.description && (
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: '0.88rem',
                mt: 1,
                maxWidth: 640,
              }}
            >
              {list.description}
            </Typography>
          )}
        </Box>
        <Stack direction="row" flexWrap="wrap" sx={{ gap: 1.5 }} flexShrink={0}>
          <Stat
            label="Subscribed"
            value={list.subscriberCount}
            color="#4ade80"
          />
          <Stat label="Pending" value={list.pendingCount} />
          <Stat label="Unsubscribed" value={list.unsubscribedCount} />
        </Stack>
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        flexWrap="wrap"
        sx={{ mb: 2.5, rowGap: 1 }}
      >
        <Button
          variant="contained"
          startIcon={<UserPlus size={15} />}
          onClick={() => setDialog('add')}
        >
          Add subscribers
        </Button>
        <OutlineButton
          icon={<Users size={15} />}
          onClick={() => setDialog('portal')}
        >
          Add portal users
        </OutlineButton>
        <OutlineButton
          icon={
            exportCsv.isPending ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <Download size={15} />
            )
          }
          onClick={handleExport}
          disabled={exportCsv.isPending}
        >
          Export CSV
        </OutlineButton>
        <OutlineButton
          icon={<Pencil size={14} />}
          onClick={() => setDialog('edit')}
        >
          Edit
        </OutlineButton>
        {list.isPublic && !list.archivedAt && (
          <OutlineButton
            icon={<Code2 size={15} />}
            onClick={() => setDialog('embed')}
          >
            Embed
          </OutlineButton>
        )}
      </Stack>

      {subscribersQuery.isError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => subscribersQuery.refetch()}
            >
              Retry
            </Button>
          }
        >
          Couldn&apos;t load subscribers:{' '}
          {extractErrorMessage(subscribersQuery.error)}
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

      <TableContainer
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 0.75,
          bgcolor: 'background.paper',
        }}
      >
        <Table size="small" sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              <TableCell>Email</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Source</TableCell>
              <TableCell>Subscribed</TableCell>
              <TableCell align="right" sx={{ width: 56 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {subscribersQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={22} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {debouncedSearch || status !== 'ALL'
                      ? 'No subscribers match your filters.'
                      : 'Nobody is on this list yet. Add subscribers to get started.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map(row => (
                <TableRow
                  key={row.subscriptionId}
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
                    <Stack direction="row" spacing={0.75}>
                      <SubscriptionStatusChip status={row.subscriptionStatus} />
                      {row.subscriberStatus !== SubscriberStatus.ACTIVE && (
                        <SubscriberStatusChip
                          status={row.subscriberStatus}
                          label={
                            row.subscriberStatus ===
                            SubscriberStatus.UNSUBSCRIBED
                              ? 'Opted out of all'
                              : undefined
                          }
                        />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell
                    sx={{ fontSize: '0.8rem', color: 'text.secondary' }}
                  >
                    {SUBSCRIPTION_SOURCE_LABELS[row.source]}
                  </TableCell>
                  <TableCell
                    sx={{
                      fontFamily: fontFamilyMono,
                      fontSize: '0.78rem',
                      color: 'text.secondary',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatCohortDate(row.confirmedAt ?? row.createdAt)}
                    {row.unsubscribedAt && (
                      <Box component="div" sx={{ fontSize: '0.7rem' }}>
                        left {formatCohortDate(row.unsubscribedAt)}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Remove from this list">
                      <IconButton
                        size="small"
                        aria-label={`Remove ${row.email} from this list`}
                        onClick={() => setRemoving(row)}
                        sx={{
                          color: 'text.secondary',
                          '&:hover': { color: 'error.main' },
                        }}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </Tooltip>
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

      {dialog === 'add' && (
        <AddSubscribersDialog
          listId={list.id}
          listName={list.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'portal' && (
        <AddPortalUsersDialog
          listId={list.id}
          listName={list.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'edit' && (
        <MailingListFormDialog
          list={list}
          onClose={() => setDialog(null)}
          onSaved={saved => {
            setDialog(null);
            show('success', `Saved ${saved.name}.`);
          }}
        />
      )}
      {dialog === 'embed' && (
        <EmbedDialog list={list} onClose={() => setDialog(null)} />
      )}

      {removing && (
        <ConfirmDialog
          title="Remove from this list?"
          confirmLabel="Remove"
          destructive
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await removeSubscription.mutateAsync({
              listId: list.id,
              subscriptionId: removing.subscriptionId,
            });
            show('success', `Removed ${removing.email}.`);
          }}
        >
          <Box component="p" sx={{ mt: 0 }}>
            <strong>{removing.email}</strong> will be taken off{' '}
            <strong>{list.name}</strong>. Their address stays in the subscriber
            database and on any other list.
          </Box>
          {removing.subscriptionStatus === SubscriptionStatus.UNSUBSCRIBED && (
            <Box component="p" sx={{ mb: 0 }}>
              They unsubscribed from this list. Removing the row also forgets
              that, so a later import would add them again without asking.
            </Box>
          )}
        </ConfirmDialog>
      )}

      <ToastSnackbar toast={toast} onClose={close} />
    </FellowshipPageLayout>
  );
};

export default MailingListDetail;
