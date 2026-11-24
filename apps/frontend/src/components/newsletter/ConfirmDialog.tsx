import { useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import { extractErrorMessage } from '../../utils/errorUtils';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Red confirm button, for actions that cannot be undone. */
  destructive?: boolean;
  /** A rejection keeps the dialog open and shows the API's message. */
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

/**
 * Mount it while it should be open; unmounting resets it. The API explains
 * why it refused (e.g. a list a newsletter still uses), so that message is
 * shown in the dialog rather than lost in a toast.
 */
const ConfirmDialog = ({
  title,
  children,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: Props) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(extractErrorMessage(e));
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onClose={pending ? undefined : onClose}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent sx={{ color: 'text.secondary', fontSize: '0.9rem' }}>
        {children}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={onClose}
          disabled={pending}
          sx={{ color: 'text.secondary' }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color={destructive ? 'error' : 'primary'}
          onClick={confirm}
          disabled={pending}
          startIcon={
            pending ? <CircularProgress size={14} color="inherit" /> : undefined
          }
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog;
