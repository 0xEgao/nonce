import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  CohortType,
  PortalAudience,
  type AddPortalUsersRequest,
  type AddSubscribersResponse,
} from '@nonce/shared';
import { useCohorts } from '../../../hooks/cohortHooks';
import { useAddPortalUsersToMailingList } from '../../../hooks/newsletterHooks';
import { cohortTypeToName } from '../../../helpers/cohortHelpers';
import { extractErrorMessage } from '../../../utils/errorUtils';
import AddSubscribersCounts from './AddSubscribersCounts';
import { PORTAL_AUDIENCE_LABELS, plural } from '../shared/newsletterUtils';

const AUDIENCES = Object.values(PortalAudience);
const COHORT_TYPES = Object.values(CohortType);

const AUDIENCE_HELP: Record<PortalAudience, string> = {
  [PortalAudience.ALL_USERS]: 'Every portal user who has an email address.',
  [PortalAudience.COHORT_MEMBERS]: 'Everyone who joined the cohort you pick.',
  [PortalAudience.COHORT_TYPE_MEMBERS]:
    'Everyone who joined any season of the course you pick.',
  [PortalAudience.WAITLIST]:
    'People waiting for a cohort, optionally for one course only.',
  [PortalAudience.FELLOWS]: 'Anyone with a fellowship.',
};

interface Props {
  listId: string;
  listName: string;
  onClose: () => void;
}

/**
 * Copies portal users into a list in two steps: a dry run that only counts,
 * then the real thing. Changing any choice discards the preview, so what gets
 * confirmed is always what was counted. Mount it while it should be open.
 */
const AddPortalUsersDialog = ({ listId, listName, onClose }: Props) => {
  const [audience, setAudience] = useState<PortalAudience>(
    PortalAudience.ALL_USERS
  );
  const [cohortId, setCohortId] = useState('');
  const [cohortType, setCohortType] = useState<CohortType | ''>('');
  const [resubscribe, setResubscribe] = useState(false);
  const [preview, setPreview] = useState<{
    key: string;
    result: AddSubscribersResponse;
  } | null>(null);
  const [done, setDone] = useState<AddSubscribersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addUsers = useAddPortalUsersToMailingList();
  const pending = addUsers.isPending;

  const needsCohort = audience === PortalAudience.COHORT_MEMBERS;
  const cohortsQuery = useCohorts(
    { page: 0, pageSize: 100 },
    { enabled: needsCohort }
  );
  // Newest first: the cohort someone wants is nearly always a recent one.
  const cohorts = useMemo(
    () =>
      [...(cohortsQuery.data?.records ?? [])].sort((a, b) =>
        b.startDate.localeCompare(a.startDate)
      ),
    [cohortsQuery.data?.records]
  );

  const needsCohortType = audience === PortalAudience.COHORT_TYPE_MEMBERS;
  const mayFilterByType = audience === PortalAudience.WAITLIST;
  const complete =
    (!needsCohort || cohortId !== '') &&
    (!needsCohortType || cohortType !== '');

  const body: AddPortalUsersRequest = {
    audience,
    ...(needsCohort ? { cohortId } : {}),
    ...((needsCohortType || mayFilterByType) && cohortType
      ? { cohortType }
      : {}),
    resubscribe,
  };
  const key = JSON.stringify(body);
  const currentPreview = preview?.key === key ? preview.result : null;

  const run = async (dryRun: boolean) => {
    if (!complete) return;
    setError(null);
    try {
      const result = await addUsers.mutateAsync({
        listId,
        body: { ...body, ...(dryRun ? { dryRun: true } : {}) },
      });
      if (dryRun) setPreview({ key, result });
      else setDone(result);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  };

  const toggleSx = { color: 'text.secondary', fontSize: '0.75rem', ml: 4 };

  return (
    <Dialog
      open
      onClose={pending ? undefined : onClose}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle sx={{ fontWeight: 700 }}>
        Add portal users to {listName}
      </DialogTitle>
      <DialogContent>
        {done ? (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <AddSubscribersCounts result={done} resubscribe={resubscribe} />
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
              Copies existing portal accounts into this list. They are
              subscribed straight away, with no confirmation email. Users
              without an email address are skipped.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              select
              size="small"
              fullWidth
              label="Who"
              value={audience}
              onChange={event =>
                setAudience(event.target.value as PortalAudience)
              }
              helperText={AUDIENCE_HELP[audience]}
            >
              {AUDIENCES.map(value => (
                <MenuItem key={value} value={value}>
                  {PORTAL_AUDIENCE_LABELS[value]}
                </MenuItem>
              ))}
            </TextField>

            {needsCohort && (
              <TextField
                select
                size="small"
                fullWidth
                label="Cohort"
                value={cohortId}
                onChange={event => setCohortId(event.target.value)}
                disabled={cohortsQuery.isLoading}
                error={cohortsQuery.isError}
                helperText={
                  cohortsQuery.isError
                    ? `Couldn't load cohorts: ${extractErrorMessage(cohortsQuery.error)}`
                    : cohortsQuery.isLoading
                      ? 'Loading cohorts…'
                      : undefined
                }
              >
                {cohorts.map(cohort => (
                  <MenuItem key={cohort.id} value={cohort.id}>
                    {cohort.displayName} — Season {cohort.season}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {(needsCohortType || mayFilterByType) && (
              <TextField
                select
                size="small"
                fullWidth
                label={mayFilterByType ? 'Course (optional)' : 'Course'}
                value={cohortType}
                onChange={event =>
                  setCohortType(event.target.value as CohortType | '')
                }
                slotProps={{
                  select: { displayEmpty: mayFilterByType },
                  inputLabel: mayFilterByType ? { shrink: true } : undefined,
                }}
              >
                {mayFilterByType && <MenuItem value="">Any course</MenuItem>}
                {COHORT_TYPES.map(type => (
                  <MenuItem key={type} value={type}>
                    {cohortTypeToName(type)}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <div>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={resubscribe}
                    onChange={event => setResubscribe(event.target.checked)}
                  />
                }
                label="Also re-subscribe people who previously unsubscribed"
              />
              <Typography sx={toggleSx}>
                Covers users who left this list, or were marked unsubscribed or
                bounced. Leave it off unless they asked to come back.
              </Typography>
            </div>

            {currentPreview && (
              <Stack spacing={1}>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  Preview
                </Typography>
                <AddSubscribersCounts
                  result={currentPreview}
                  dryRun
                  resubscribe={resubscribe}
                />
                <Typography
                  sx={{ color: 'text.secondary', fontSize: '0.78rem' }}
                >
                  Nothing has been added yet.
                </Typography>
              </Stack>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {done ? (
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button
              onClick={onClose}
              disabled={pending}
              sx={{ color: 'text.secondary' }}
            >
              Cancel
            </Button>
            {currentPreview ? (
              <Button
                variant="contained"
                onClick={() => run(false)}
                disabled={pending || currentPreview.added === 0}
                startIcon={
                  pending ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : undefined
                }
              >
                {currentPreview.added === 0
                  ? 'Nobody to add'
                  : `Add ${plural(currentPreview.added, 'user')}`}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={() => run(true)}
                disabled={pending || !complete}
                startIcon={
                  pending ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : undefined
                }
              >
                Preview
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default AddPortalUsersDialog;
