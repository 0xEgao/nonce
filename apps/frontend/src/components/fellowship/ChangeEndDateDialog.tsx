import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { formatCohortDate } from '../../helpers/cohortHelpers';
import { useChangeFellowshipEndDate } from '../../hooks/fellowshipHooks';
import { FellowshipStatus, type GetFellowshipResponseDto } from '../../types/fellowship';
import { extractErrorMessage } from '../../utils/errorUtils';
import { MAX_CONTRACT_MONTHS, contractDay } from './contractDates';

type Props = {
  fellowship: GetFellowshipResponseDto | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
};

// Moves the end date of an active fellowship, earlier or later. A date that
// isn't in the future completes the fellowship as soon as it's saved.
const ChangeEndDateDialog = ({ fellowship, onClose, onSuccess, onError }: Props) => {
  // Keep showing the last fellowship while the dialog fades out, rather than
  // blank text. MUI unmounts the form once closed, so reopening starts fresh.
  const [lastFellowship, setLastFellowship] = useState(fellowship);
  if (fellowship && fellowship !== lastFellowship) setLastFellowship(fellowship);
  const shown = fellowship ?? lastFellowship;

  return (
    <Dialog open={!!fellowship} onClose={onClose} fullWidth maxWidth="xs">
      {shown && (
        <ChangeEndDateForm
          key={shown.id}
          fellowship={shown}
          onClose={onClose}
          onSuccess={onSuccess}
          onError={onError}
        />
      )}
    </Dialog>
  );
};

// Mirrors the backend's checks, which still decide.
const validateEndDate = (value: Dayjs, fellowship: GetFellowshipResponseDto): string | null => {
  if (!value.isValid()) return 'Enter a valid date.';
  if (fellowship.startDate && !value.isAfter(contractDay(fellowship.startDate), 'day'))
    return 'End date must be after the start date.';
  if (value.isAfter(dayjs().add(MAX_CONTRACT_MONTHS, 'month'), 'day'))
    return `End date cannot be more than ${MAX_CONTRACT_MONTHS} months from today.`;
  return null;
};

const ChangeEndDateForm = ({
  fellowship,
  onClose,
  onSuccess,
  onError,
}: Omit<Props, 'fellowship'> & { fellowship: GetFellowshipResponseDto }) => {
  const currentEnd = fellowship.endDate ? contractDay(fellowship.endDate) : null;
  const [endDate, setEndDate] = useState<Dayjs | null>(currentEnd);
  const changeMut = useChangeFellowshipEndDate();
  const name = fellowship.userName ?? fellowship.userEmail ?? 'this fellow';

  const error = endDate ? validateEndDate(endDate, fellowship) : null;
  const unchanged = !!endDate && !!currentEnd && endDate.isSame(currentEnd, 'day');
  // The backend stores midnight UTC of the picked day and completes the
  // fellowship when that moment isn't in the future. Same test here.
  const endsNow =
    !!endDate && !error && new Date(endDate.format('YYYY-MM-DD')).getTime() <= Date.now();
  const canSubmit = !!endDate && !error && !unchanged && !changeMut.isPending;

  const handleSubmit = async () => {
    if (!endDate || !canSubmit) return;
    try {
      const updated = await changeMut.mutateAsync({
        id: fellowship.id,
        body: { endDate: endDate.format('YYYY-MM-DD') },
      });
      onSuccess(
        updated.status === FellowshipStatus.COMPLETED
          ? `Ended ${name}'s fellowship.`
          : `${name}'s fellowship now ends on ${formatCohortDate(updated.endDate ?? '')}.`,
      );
    } catch (e) {
      onError(extractErrorMessage(e));
    }
  };

  return (
    <>
      <DialogTitle sx={{ fontWeight: 700 }}>Change end date — {name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {fellowship.startDate && `Started ${formatCohortDate(fellowship.startDate)}.`}
            {fellowship.originalEndDate &&
              ` Contracted to end ${formatCohortDate(fellowship.originalEndDate)}.`}
          </Typography>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="End date"
              value={endDate}
              onChange={setEndDate}
              slotProps={{
                textField: {
                  size: 'small',
                  fullWidth: true,
                  error: !!error,
                  helperText: error ?? 'Earlier or later than the current end date.',
                },
              }}
            />
          </LocalizationProvider>
          {endsNow && (
            <Alert severity="warning">
              This date isn't in the future, so saving completes the fellowship now. That
              can't be undone.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color={endsNow ? 'error' : 'primary'}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {changeMut.isPending ? 'Saving…' : endsNow ? 'End fellowship' : 'Save end date'}
        </Button>
      </DialogActions>
    </>
  );
};

export default ChangeEndDateDialog;
