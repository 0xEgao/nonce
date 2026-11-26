import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import type { GetFellowshipResponseDto } from '../../types/fellowship';

type Props = {
  fellowship: GetFellowshipResponseDto | null;
  onClose: () => void;
  onConfirm: (fellowship: GetFellowshipResponseDto) => void;
};

// Confirmation before ending a running fellowship early.
const EndFellowshipDialog = ({ fellowship, onClose, onConfirm }: Props) => {
  const name = fellowship?.userName ?? fellowship?.userEmail ?? 'this fellow';

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
        <Button
          variant="contained"
          color="error"
          onClick={() => fellowship && onConfirm(fellowship)}
        >
          End fellowship
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EndFellowshipDialog;
