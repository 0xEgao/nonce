import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { formatCohortDate } from '../../helpers/cohortHelpers';
import { useEndFellowship } from '../../hooks/fellowshipHooks';
import type { GetFellowshipResponseDto } from '../../types/fellowship';
import { extractErrorMessage } from '../../utils/errorUtils';
import { formatFellowshipType } from '../../utils/fellowshipFormat';

type Props = {
  fellowship: GetFellowshipResponseDto | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
};

// Confirms ending an ACTIVE fellowship before its contract end date. There is
// no way to undo this from the app, so the dialog spells out what changes.
const EndFellowshipDialog = ({
  fellowship,
  onClose,
  onSuccess,
  onError,
}: Props) => {
  const endMut = useEndFellowship();
  const name = fellowship?.userName ?? fellowship?.userEmail ?? 'this fellow';

  const handleConfirm = async () => {
    if (!fellowship) return;
    try {
      await endMut.mutateAsync({ id: fellowship.id });
      onSuccess(`Ended ${name}'s fellowship.`);
    } catch (e) {
      onError(extractErrorMessage(e));
    }
  };

  return (
    <Dialog open={!!fellowship} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 700 }}>End fellowship: {name}</DialogTitle>
      <DialogContent>
        {fellowship && (
          <>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              This ends {name}'s {formatFellowshipType(fellowship.type)}{' '}
              fellowship today
              {fellowship.endDate
                ? ` instead of on ${formatCohortDate(fellowship.endDate)}`
                : ''}
              .
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5, typography: 'body2' }}>
              <li>
                The fellowship moves to Completed, with today as its end date.
              </li>
              <li>The fellow is removed from the public fellows list.</li>
              <li>The fellow can still submit their final monthly report.</li>
            </Box>
            <Typography
              variant="body2"
              sx={{ mt: 1.5, color: 'text.secondary' }}
            >
              The fellow is not emailed. You can't undo this from the app.
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={endMut.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={handleConfirm}
          disabled={!fellowship || endMut.isPending}
        >
          {endMut.isPending ? 'Ending…' : 'End fellowship'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EndFellowshipDialog;
