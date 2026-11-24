import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Upload } from 'lucide-react';
import { useUploadNewsletterImage } from '../../../hooks/newsletterHooks';
import {
  apiErrorMessage,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
} from './newsletterUtils';

export interface ImageDraft {
  /** Changes on every open, so the form starts from this draft. */
  key: number;
  src: string;
  alt: string;
  /** An image is selected; saving updates it instead of inserting. */
  editing: boolean;
}

export interface ImageResult {
  src: string;
  alt: string;
}

interface Props {
  open: boolean;
  draft: ImageDraft | null;
  onClose: () => void;
  onSave: (result: ImageResult) => void;
}

const ImageDialog = ({ open, draft, onClose, onSave }: Props) => (
  <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
    {draft && (
      <ImageForm
        key={draft.key}
        draft={draft}
        onClose={onClose}
        onSave={onSave}
      />
    )}
  </Dialog>
);

const ImageForm = ({
  draft,
  onClose,
  onSave,
}: Omit<Props, 'open' | 'draft'> & { draft: ImageDraft }) => {
  const [src, setSrc] = useState(draft.src);
  const [alt, setAlt] = useState(draft.alt);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useUploadNewsletterImage();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!IMAGE_MIME_TYPES.includes(file.type)) {
      setError('Use a PNG, JPEG, GIF or WebP image.');
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setError('Images can be up to 2 MB.');
      return;
    }
    try {
      const { url } = await upload.mutateAsync({ file });
      setSrc(url);
      if (!alt.trim()) setAlt(file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const submit = () => {
    const url = src.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      setError('Upload an image or paste a full http(s) URL.');
      return;
    }
    onSave({ src: url, alt: alt.trim() });
  };

  return (
    <Box
      component="form"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogTitle sx={{ fontWeight: 700 }}>
        {draft.editing ? 'Edit image' : 'Insert image'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction="row" spacing={1.5} alignItems="center">
            <input
              ref={fileInput}
              type="file"
              accept={IMAGE_MIME_TYPES.join(',')}
              hidden
              onChange={e => {
                void handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              variant="outlined"
              startIcon={
                upload.isPending ? (
                  <CircularProgress size={14} />
                ) : (
                  <Upload size={14} />
                )
              }
              disabled={upload.isPending}
              onClick={() => fileInput.current?.click()}
              sx={{ color: 'text.primary', borderColor: 'divider' }}
            >
              {upload.isPending ? 'Uploading…' : 'Upload image'}
            </Button>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              PNG, JPEG, GIF or WebP, up to 2 MB.
            </Typography>
          </Stack>
          <TextField
            label="Image URL"
            size="small"
            fullWidth
            value={src}
            onChange={e => {
              setSrc(e.target.value);
              setError(null);
            }}
            placeholder="https://…"
            helperText="Filled in by an upload, or paste the address of an image that is already online."
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <TextField
            label="Alt text"
            size="small"
            fullWidth
            value={alt}
            onChange={e => setAlt(e.target.value)}
            helperText="Shown when images are blocked, and read out by screen readers."
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />
          {/^https?:\/\//i.test(src.trim()) && (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
                bgcolor: '#111111',
                textAlign: 'center',
              }}
            >
              <Box
                component="img"
                src={src.trim()}
                alt={alt}
                sx={{
                  maxWidth: '100%',
                  maxHeight: 220,
                  display: 'inline-block',
                }}
              />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          variant="contained"
          disabled={!src.trim() || upload.isPending}
        >
          {draft.editing ? 'Save' : 'Insert'}
        </Button>
      </DialogActions>
    </Box>
  );
};

export default ImageDialog;
