import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  ListItemIcon,
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
  Typography,
} from '@mui/material';
import {
  Copy,
  EllipsisVertical,
  ExternalLink,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import {
  NewsletterStatus,
  type NewsletterSummaryResponse,
} from '@nonce/shared';
import FellowshipPageLayout from '../../../components/fellowship/FellowshipPageLayout';
import { fontFamilyMono } from '../../../components/fellowship/theme';
import NewsletterAdminTabs from '../../../components/newsletter/NewsletterAdminTabs';
import ConfirmDialog from '../../../components/newsletter/composer/ConfirmDialog';
import FilterPill from '../../../components/newsletter/composer/FilterPill';
import NewsletterStatusChip from '../../../components/newsletter/composer/NewsletterStatusChip';
import PaginationFooter from '../../../components/newsletter/composer/PaginationFooter';
import {
  apiErrorMessage,
  isPausedNow,
} from '../../../components/newsletter/composer/newsletterUtils';
import {
  useCreateNewsletter,
  useDeleteNewsletter,
  useDuplicateNewsletter,
  useNewsletters,
} from '../../../hooks/newsletterHooks';
import { useDebounce } from '../../../hooks/useDebounce';
import { formatDateTime } from '../../../utils/dateUtils';
import { isBadFilterError } from '../../../utils/errorUtils';

const DEFAULT_PAGE_SIZE = 25;
// While anything on the page is sending, its counts move; refresh them.
const SENDING_REFRESH_MS = 10000;

type StatusFilter = NewsletterStatus | 'ALL';

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'ALL' },
  { label: 'Drafts', value: NewsletterStatus.DRAFT },
  { label: 'Scheduled', value: NewsletterStatus.SCHEDULED },
  { label: 'Sending', value: NewsletterStatus.SENDING },
  { label: 'Sent', value: NewsletterStatus.SENT },
  { label: 'Cancelled', value: NewsletterStatus.CANCELLED },
];

const headCellSx = { py: 1.25, px: 2, letterSpacing: 0.8 };
const cellSx = { py: 1.5, px: 2 };
const monoSx = {
  fontFamily: fontFamilyMono,
  fontSize: '0.78rem',
  color: 'text.secondary',
  whiteSpace: 'nowrap',
};
const COLUMN_COUNT = 7;

const NewslettersAdmin = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [toast, setToast] = useState<{
    kind: 'success' | 'error';
    msg: string;
  } | null>(null);
  const [toDelete, setToDelete] = useState<NewsletterSummaryResponse | null>(
    null
  );
  const debouncedSearch = useDebounce(search.trim(), 300);

  useEffect(() => {
    setPage(0);
  }, [status, debouncedSearch, pageSize]);

  const { data, isLoading, isError, error } = useNewsletters(
    {
      page,
      pageSize,
      ...(status !== 'ALL' ? { status } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    },
    {
      placeholderData: previous => previous,
      refetchInterval: query =>
        query.state.data?.records.some(
          n => n.status === NewsletterStatus.SENDING
        )
          ? SENDING_REFRESH_MS
          : false,
    }
  );
  const createNewsletter = useCreateNewsletter();
  const duplicateNewsletter = useDuplicateNewsletter();
  const deleteNewsletter = useDeleteNewsletter();

  const records = useMemo(() => data?.records ?? [], [data?.records]);
  const total = data?.totalRecords ?? 0;
  const filtered = status !== 'ALL' || !!debouncedSearch;

  const handleCreate = async () => {
    setToast(null);
    try {
      const created = await createNewsletter.mutateAsync({});
      navigate(`/admin/newsletter/${created.id}`);
    } catch (e) {
      setToast({
        kind: 'error',
        msg: `Couldn't create a newsletter: ${apiErrorMessage(e)}`,
      });
    }
  };

  const handleDuplicate = async (newsletter: NewsletterSummaryResponse) => {
    setToast(null);
    try {
      const copy = await duplicateNewsletter.mutateAsync({ id: newsletter.id });
      navigate(`/admin/newsletter/${copy.id}`);
    } catch (e) {
      setToast({ kind: 'error', msg: apiErrorMessage(e) });
    }
  };

  const createButton = (
    <Button
      variant="contained"
      startIcon={
        createNewsletter.isPending ? (
          <CircularProgress size={14} color="inherit" />
        ) : (
          <Plus size={14} />
        )
      }
      onClick={handleCreate}
      disabled={createNewsletter.isPending}
      sx={{ whiteSpace: 'nowrap' }}
    >
      New newsletter
    </Button>
  );

  return (
    <FellowshipPageLayout
      title="Newsletter"
      subtitle="Write, schedule and send newsletters."
      badge="Admin"
      hideIcon
    >
      <NewsletterAdminTabs />

      {toast && (
        <Alert
          severity={toast.kind}
          sx={{ mb: 2 }}
          onClose={() => setToast(null)}
        >
          {toast.msg}
        </Alert>
      )}

      {isError && (
        <Alert
          severity={isBadFilterError(error) ? 'warning' : 'error'}
          sx={{ mb: 2 }}
        >
          {isBadFilterError(error)
            ? `Invalid filter or search. Adjust it and try again. (${apiErrorMessage(error)})`
            : `Couldn't load newsletters: ${apiErrorMessage(error)}`}
        </Alert>
      )}

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', md: 'center' }}
        sx={{ mb: 2 }}
      >
        <Stack
          direction="row"
          spacing={0.75}
          flexWrap="wrap"
          sx={{ rowGap: 1 }}
        >
          {STATUS_FILTERS.map(f => (
            <FilterPill
              key={f.value}
              label={f.label}
              active={status === f.value}
              onClick={() => setStatus(f.value)}
            />
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search subject…"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={14} />
                  </InputAdornment>
                ),
              },
              htmlInput: { maxLength: 100, 'aria-label': 'Search newsletters' },
            }}
            sx={{ flexGrow: 1, minWidth: { md: 280 } }}
          />
          {createButton}
        </Stack>
      </Stack>

      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 0.75,
          bgcolor: 'background.paper',
        }}
      >
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table sx={{ minWidth: 960 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={headCellSx}>Subject</TableCell>
                <TableCell sx={headCellSx}>Status</TableCell>
                <TableCell sx={headCellSx}>Audience</TableCell>
                <TableCell sx={headCellSx}>Delivered</TableCell>
                <TableCell sx={headCellSx}>Scheduled / sent</TableCell>
                <TableCell sx={headCellSx}>Updated</TableCell>
                <TableCell sx={{ ...headCellSx, width: 56 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} sx={{ border: 'none' }}>
                    <Box
                      sx={{ display: 'flex', justifyContent: 'center', py: 6 }}
                    >
                      <CircularProgress size={22} />
                    </Box>
                  </TableCell>
                </TableRow>
              ) : records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUMN_COUNT} sx={{ border: 'none' }}>
                    <Box sx={{ py: 6, textAlign: 'center' }}>
                      {filtered || isError ? (
                        <Typography
                          variant="body2"
                          sx={{ color: 'text.secondary' }}
                        >
                          {isError
                            ? 'Nothing to show.'
                            : 'No newsletters match these filters.'}
                        </Typography>
                      ) : (
                        <Stack spacing={1.5} alignItems="center">
                          <Typography sx={{ fontWeight: 600 }}>
                            No newsletters yet
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ color: 'text.secondary' }}
                          >
                            Start a draft; it saves as you write.
                          </Typography>
                          {createButton}
                        </Stack>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ) : (
                records.map(newsletter => (
                  <NewsletterRow
                    key={newsletter.id}
                    newsletter={newsletter}
                    onOpen={() =>
                      navigate(`/admin/newsletter/${newsletter.id}`)
                    }
                    onDuplicate={() => void handleDuplicate(newsletter)}
                    onDelete={() => setToDelete(newsletter)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {!isLoading && total > 0 && (
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </Box>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this draft?"
        confirmLabel="Delete"
        destructive
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          await deleteNewsletter.mutateAsync({ id: toDelete.id });
          setToast({ kind: 'success', msg: 'Draft deleted.' });
        }}
      >
        "{toDelete?.subject}" will be deleted. This can't be undone.
      </ConfirmDialog>
    </FellowshipPageLayout>
  );
};

// ---- row ----

const dateColumn = (
  newsletter: NewsletterSummaryResponse
): { label: string; value: string } | null => {
  switch (newsletter.status) {
    case NewsletterStatus.SCHEDULED:
      return {
        label: 'Scheduled',
        value: formatDateTime(newsletter.scheduledAt),
      };
    case NewsletterStatus.SENDING:
      return {
        label: 'Started',
        value: formatDateTime(newsletter.sendStartedAt),
      };
    case NewsletterStatus.SENT:
      return { label: 'Sent', value: formatDateTime(newsletter.sentAt) };
    case NewsletterStatus.CANCELLED:
      return newsletter.sendStartedAt
        ? { label: 'Started', value: formatDateTime(newsletter.sendStartedAt) }
        : null;
    default:
      return null;
  }
};

const NewsletterRow = ({
  newsletter,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  newsletter: NewsletterSummaryResponse;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) => {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const { stats } = newsletter;
  const isDraft = newsletter.status === NewsletterStatus.DRAFT;
  const hasDeliveries =
    newsletter.status !== NewsletterStatus.DRAFT &&
    newsletter.status !== NewsletterStatus.SCHEDULED;
  const paused =
    newsletter.status === NewsletterStatus.SENDING &&
    isPausedNow(newsletter.pausedUntil);
  const date = dateColumn(newsletter);

  return (
    <TableRow
      hover
      onClick={onOpen}
      sx={{
        cursor: 'pointer',
        '&:last-child td': { borderBottom: 'none' },
      }}
    >
      <TableCell sx={{ ...cellSx, maxWidth: 320 }}>
        <Typography
          title={newsletter.subject}
          sx={{
            fontWeight: 600,
            fontSize: '0.88rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {newsletter.subject}
        </Typography>
        {newsletter.createdByName && (
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', fontSize: '0.72rem' }}
          >
            {newsletter.createdByName}
          </Typography>
        )}
      </TableCell>

      <TableCell sx={cellSx}>
        <NewsletterStatusChip
          status={newsletter.status}
          label={paused ? 'Paused' : undefined}
        />
      </TableCell>

      <TableCell sx={{ ...cellSx, maxWidth: 260 }}>
        <AudienceCell
          listNames={newsletter.listNames}
          adHocCount={newsletter.adHocCount}
        />
      </TableCell>

      <TableCell sx={cellSx}>
        {hasDeliveries ? (
          <Box>
            <Typography sx={{ ...monoSx, color: 'text.primary' }}>
              {stats.sent.toLocaleString()} / {stats.total.toLocaleString()}
            </Typography>
            {stats.failed > 0 && (
              <Typography
                sx={{ fontSize: '0.72rem', color: 'error.main', mt: 0.25 }}
              >
                {stats.failed.toLocaleString()} failed
              </Typography>
            )}
          </Box>
        ) : (
          <Typography sx={monoSx}>—</Typography>
        )}
      </TableCell>

      <TableCell sx={cellSx}>
        {date ? (
          <Box>
            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
              {date.label}
            </Typography>
            <Typography sx={monoSx}>{date.value}</Typography>
          </Box>
        ) : (
          <Typography sx={monoSx}>—</Typography>
        )}
      </TableCell>

      <TableCell sx={cellSx}>
        <Typography sx={monoSx}>
          {formatDateTime(newsletter.updatedAt)}
        </Typography>
      </TableCell>

      <TableCell sx={{ ...cellSx, py: 0.5 }} onClick={e => e.stopPropagation()}>
        <IconButton
          size="small"
          aria-label={`Actions for ${newsletter.subject}`}
          onClick={e => setMenuAnchor(e.currentTarget)}
          sx={{ color: 'text.secondary' }}
        >
          <EllipsisVertical size={16} />
        </IconButton>
        <Menu
          anchorEl={menuAnchor}
          open={!!menuAnchor}
          onClose={() => setMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onOpen();
            }}
          >
            <ListItemIcon>
              <ExternalLink size={15} />
            </ListItemIcon>
            Open
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              onDuplicate();
            }}
          >
            <ListItemIcon>
              <Copy size={15} />
            </ListItemIcon>
            Duplicate
          </MenuItem>
          {isDraft && (
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                onDelete();
              }}
              sx={{ color: 'error.main' }}
            >
              <ListItemIcon sx={{ color: 'inherit' }}>
                <Trash2 size={15} />
              </ListItemIcon>
              Delete
            </MenuItem>
          )}
        </Menu>
      </TableCell>
    </TableRow>
  );
};

const AudienceCell = ({
  listNames,
  adHocCount,
}: {
  listNames: string[];
  adHocCount: number;
}) => {
  if (listNames.length === 0 && adHocCount === 0) {
    return <Typography sx={monoSx}>—</Typography>;
  }
  const lists = listNames.join(', ');
  return (
    <Box sx={{ minWidth: 0 }}>
      {lists && (
        <Typography
          title={lists}
          sx={{
            fontSize: '0.82rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {lists}
        </Typography>
      )}
      {adHocCount > 0 && (
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
          + {adHocCount.toLocaleString()} address
          {adHocCount === 1 ? '' : 'es'}
        </Typography>
      )}
    </Box>
  );
};

export default NewslettersAdmin;
