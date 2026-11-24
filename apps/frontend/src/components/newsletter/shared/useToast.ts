import { useCallback, useState } from 'react';

export interface ToastState {
  kind: 'success' | 'error';
  msg: string;
  open: boolean;
}

/**
 * Keeps the last message after closing, so the snackbar does not go blank
 * while it fades out.
 */
export const useToast = () => {
  const [toast, setToast] = useState<ToastState>({
    kind: 'success',
    msg: '',
    open: false,
  });

  const show = useCallback(
    (kind: ToastState['kind'], msg: string) =>
      setToast({ kind, msg, open: true }),
    []
  );
  const close = useCallback(
    () => setToast(current => ({ ...current, open: false })),
    []
  );

  return { toast, show, close };
};
