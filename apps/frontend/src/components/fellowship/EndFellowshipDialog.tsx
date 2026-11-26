import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useEndFellowship } from '../../hooks/fellowshipHooks';
import type { GetFellowshipResponseDto } from '../../types/fellowship';
import { extractErrorMessage } from '../../utils/errorUtils';

type Props = {
  fellowship: GetFellowshipResponseDto | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
};

// Confirmation before ending a running fellowship early. The list updates
// optimistically (see useEndFellowship), so the dialog closes on confirm.
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
    onClose();
    try {
      await endMut.mutateAsync({ id: fellowship.id });
      onSuccess(`Ended ${name}'s fellowship.`);
    } catch (e) {
      onError(extractErrorMessage(e));
    }
  };

  return (
    <Dialog open={!!fellowship} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700 }}>End fellowship?</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          End {name}'s fellowship today? This can't be undone.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="error" onClick={handleConfirm}>
          End fellowship
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EndFellowshipDialog;
