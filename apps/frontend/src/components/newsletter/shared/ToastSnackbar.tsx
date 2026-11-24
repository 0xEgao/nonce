import { Alert, Snackbar } from '@mui/material';
import type { ToastState } from './useToast';

const ToastSnackbar = ({
  toast,
  onClose,
}: {
  toast: ToastState;
  onClose: () => void;
}) => (
  <Snackbar
    open={toast.open}
    autoHideDuration={5000}
    onClose={(_, reason) => {
      if (reason !== 'clickaway') onClose();
    }}
    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
  >
    <Alert
      severity={toast.kind}
      variant="filled"
      onClose={onClose}
      sx={{ width: '100%', fontWeight: 500 }}
    >
      {toast.msg}
    </Alert>
  </Snackbar>
);

export default ToastSnackbar;
