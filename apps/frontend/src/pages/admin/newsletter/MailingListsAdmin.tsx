import { useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Archive,
  ArchiveRestore,
  Code2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { MailingListResponse } from '@nonce/shared';
import FellowshipPageLayout from '../../../components/fellowship/FellowshipPageLayout';
import { fontFamilyMono } from '../../../components/fellowship/theme';
import ConfirmDialog from '../../../components/newsletter/shared/ConfirmDialog';
import EmbedDialog from '../../../components/newsletter/lists/EmbedDialog';
import MailingListFormDialog from '../../../components/newsletter/lists/MailingListFormDialog';
import NewsletterAdminTabs from '../../../components/newsletter/shared/NewsletterAdminTabs';
import {
  ArchivedChip,
  ListVisibilityChip,
} from '../../../components/newsletter/shared/StatusChips';
import ToastSnackbar from '../../../components/newsletter/shared/ToastSnackbar';
import { useToast } from '../../../components/newsletter/shared/useToast';
import { formatCohortDate } from '../../../helpers/cohortHelpers';
import {
  useDeleteMailingList,
  useMailingLists,
  useUpdateMailingList,
} from '../../../hooks/newsletterHooks';
import { extractErrorMessage } from '../../../utils/errorUtils';

type DialogKind = 'form' | 'embed' | 'delete';

const COLUMN_COUNT = 8;

const ActionButton = ({
  label,
  disabled,
  onClick,
  children,
  danger = false,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) => (
  <Tooltip title={label}>
    {/* The span keeps the tooltip working while the button is disabled. A
        disabled button lets clicks through to it, so it stops them too: the
        row itself opens the list. */}
    <span onClick={(event: MouseEvent) => event.stopPropagation()}>
      <IconButton
        size="small"
        aria-label={label}
        disabled={disabled}
        onClick={(event: MouseEvent) => {
          // The row itself opens the list.
          event.stopPropagation();
          onClick();
        }}
        sx={{
          color: 'text.secondary',
          '&:hover': { color: danger ? 'error.main' : 'text.primary' },
        }}
      >
        {children}
      </IconButton>
    </span>
  </Tooltip>
);

const Count = ({
  value,
  highlight,
}: {
  value: number;
  highlight?: 'amber';
}) => (
  <Typography
    component="span"
    sx={{
      fontFamily: fontFamilyMono,
      fontSize: '0.82rem',
      color:
        highlight === 'amber' && value > 0 ? 'warning.main' : 'text.primary',
    }}
  >
    {value.toLocaleString()}
  </Typography>
);

const NameCell = ({ list }: { list: MailingListResponse }) => (
  <Box sx={{ minWidth: 0 }}>
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography
        sx={{
          fontWeight: 600,
          fontSize: '0.86rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {list.name}
      </Typography>
      {list.archivedAt && <ArchivedChip />}
    </Stack>
    {list.description && (
      <Typography
        sx={{
          color: 'text.secondary',
          fontSize: '0.74rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {list.description}
      </Typography>
    )}
  </Box>
);

const MailingListsAdmin = () => {
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  // Kept after a dialog closes so nothing reads null mid-way through its
  // exit; `dialog` alone decides what is open.
  const [activeList, setActiveList] = useState<MailingListResponse | null>(
    null
  );
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const { toast, show, close } = useToast();

  // `includeArchived=false` would be read as a truthy string by a query-string
  // boolean, so the flag is only ever sent when it is on.
  const { data, isLoading, isError, error, refetch } = useMailingLists(
    showArchived ? { includeArchived: true } : {},
    { placeholderData: previous => previous }
  );
  const updateList = useUpdateMailingList();
  const deleteList = useDeleteMailingList();
  const lists = data ?? [];

  const open = (kind: DialogKind, list: MailingListResponse | null) => {
    setActiveList(list);
    setDialog(kind);
  };

  const toggleArchived = async (list: MailingListResponse) => {
    const archive = !list.archivedAt;
    try {
      await updateList.mutateAsync({
        id: list.id,
        body: { archived: archive },
      });
      show('success', `${list.name} ${archive ? 'archived' : 'restored'}.`);
    } catch (e) {
      show('error', extractErrorMessage(e));
    }
  };

  return (
    <FellowshipPageLayout
      title="Newsletter"
      subtitle="Mailing lists"
      badge="Admin"
      hideIcon
    >
      <NewsletterAdminTabs />

      {isError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          Couldn&apos;t load mailing lists: {extractErrorMessage(error)}
        </Alert>
      )}

      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        sx={{ mb: 2, rowGap: 1 }}
      >
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showArchived}
              onChange={event => setShowArchived(event.target.checked)}
            />
          }
          label="Show archived"
          slotProps={{ typography: { sx: { fontSize: '0.85rem' } } }}
        />
        <Button
          variant="contained"
          startIcon={<Plus size={15} />}
          onClick={() => open('form', null)}
        >
          New list
        </Button>
      </Stack>

      <TableContainer
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 0.75,
          bgcolor: 'background.paper',
        }}
      >
        <Table size="small" sx={{ minWidth: 880 }}>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Slug</TableCell>
              <TableCell>Visibility</TableCell>
              <TableCell align="right">Subscribed</TableCell>
              <TableCell align="right">Pending</TableCell>
              <TableCell align="right">Unsubscribed</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right" sx={{ width: 140 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={22} />
                </TableCell>
              </TableRow>
            ) : lists.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} align="center" sx={{ py: 6 }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {showArchived
                      ? 'No mailing lists yet.'
                      : 'No active mailing lists. Create one, or show archived lists.'}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              lists.map(list => (
                <TableRow
                  key={list.id}
                  hover
                  onClick={() => navigate(`/admin/newsletter/lists/${list.id}`)}
                  sx={{
                    cursor: 'pointer',
                    '&:last-child td': { borderBottom: 0 },
                    opacity: list.archivedAt ? 0.65 : 1,
                  }}
                >
                  <TableCell sx={{ maxWidth: 320 }}>
                    <NameCell list={list} />
                  </TableCell>
                  <TableCell
                    sx={{
                      fontFamily: fontFamilyMono,
                      fontSize: '0.78rem',
                      color: 'text.secondary',
                    }}
                  >
                    {list.slug}
                  </TableCell>
                  <TableCell>
                    <ListVisibilityChip isPublic={list.isPublic} />
                  </TableCell>
                  <TableCell align="right">
                    <Count value={list.subscriberCount} />
                  </TableCell>
                  <TableCell align="right">
                    <Count value={list.pendingCount} highlight="amber" />
                  </TableCell>
                  <TableCell align="right">
                    <Count value={list.unsubscribedCount} />
                  </TableCell>
                  <TableCell
                    sx={{
                      fontFamily: fontFamilyMono,
                      fontSize: '0.78rem',
                      color: 'text.secondary',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatCohortDate(list.createdAt)}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {list.isPublic && !list.archivedAt && (
                      <ActionButton
                        label="Embed the sign-up form"
                        onClick={() => open('embed', list)}
                      >
                        <Code2 size={16} />
                      </ActionButton>
                    )}
                    <ActionButton
                      label="Edit"
                      onClick={() => open('form', list)}
                    >
                      <Pencil size={15} />
                    </ActionButton>
                    <ActionButton
                      label={list.archivedAt ? 'Restore' : 'Archive'}
                      disabled={
                        updateList.isPending &&
                        updateList.variables?.id === list.id
                      }
                      onClick={() => toggleArchived(list)}
                    >
                      {list.archivedAt ? (
                        <ArchiveRestore size={15} />
                      ) : (
                        <Archive size={15} />
                      )}
                    </ActionButton>
                    <ActionButton
                      label="Delete"
                      danger
                      onClick={() => open('delete', list)}
                    >
                      <Trash2 size={15} />
                    </ActionButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {dialog === 'form' && (
        <MailingListFormDialog
          list={activeList}
          onClose={() => setDialog(null)}
          onSaved={(saved, created) => {
            setDialog(null);
            show(
              'success',
              created ? `Created ${saved.name}.` : `Saved ${saved.name}.`
            );
          }}
        />
      )}

      {dialog === 'embed' && activeList && (
        <EmbedDialog list={activeList} onClose={() => setDialog(null)} />
      )}

      {dialog === 'delete' && activeList && (
        <ConfirmDialog
          title={`Delete ${activeList.name}?`}
          confirmLabel="Delete list"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await deleteList.mutateAsync({ id: activeList.id });
            show('success', `Deleted ${activeList.name}.`);
          }}
        >
          <Box component="p" sx={{ mt: 0 }}>
            This permanently deletes the list and every subscription on it (
            {activeList.subscriberCount.toLocaleString()} subscribed,{' '}
            {activeList.pendingCount.toLocaleString()} pending,{' '}
            {activeList.unsubscribedCount.toLocaleString()} unsubscribed). The
            people themselves stay in your subscriber database.
          </Box>
          <Box component="p" sx={{ mb: 0 }}>
            A list that a newsletter targets cannot be deleted. Archive it
            instead to hide it from the sign-up form.
          </Box>
        </ConfirmDialog>
      )}

      <ToastSnackbar toast={toast} onClose={close} />
    </FellowshipPageLayout>
  );
};

export default MailingListsAdmin;
