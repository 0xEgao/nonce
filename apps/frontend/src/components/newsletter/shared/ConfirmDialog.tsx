import { useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { apiErrorMessage } from './newsletterUtils';

interface Props {
  /** Leave out to open on mount and close by unmounting. */
  open?: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Red confirm button, for actions that cannot be undone. */
  destructive?: boolean;
  onClose: () => void;
  /** A rejection keeps the dialog open and shows the API's message. */
  onConfirm: () => Promise<unknown>;
}

/**
 * The API explains why it refused (e.g. a list a newsletter still uses), so
 * that message is shown in the dialog rather than lost in a toast.
 */
const ConfirmDialog = ({
  open = true,
  title,
  children,
  confirmLabel,
  destructive = false,
  onClose,
  onConfirm,
}: Props) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Typography
          variant="body2"
          component="div"
          sx={{ color: 'text.secondary' }}
        >
          {children}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          onClick={confirm}
          disabled={busy}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog;
