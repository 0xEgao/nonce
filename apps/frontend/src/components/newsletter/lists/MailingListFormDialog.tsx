import { useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { MailingListResponse } from '@nonce/shared';
import {
  useCreateMailingList,
  useUpdateMailingList,
} from '../../../hooks/newsletterHooks';
import { extractErrorMessage } from '../../../utils/errorUtils';
import {
  MAILING_LIST_DESCRIPTION_MAX_LENGTH,
  MAILING_LIST_NAME_MAX_LENGTH,
  MAILING_LIST_SLUG_MAX_LENGTH,
  isValidSlug,
  slugify,
} from '../shared/newsletterUtils';

interface Props {
  /** The list to edit, or null to create one. */
  list: MailingListResponse | null;
  onClose: () => void;
  onSaved: (list: MailingListResponse, created: boolean) => void;
}

/** Mount it while it should be open; unmounting resets the form. */
const MailingListFormDialog = ({ list, onClose, onSaved }: Props) => {
  const isEdit = list !== null;
  const [name, setName] = useState(list?.name ?? '');
  // Until the admin types in the slug field it follows the name.
  const [slugInput, setSlugInput] = useState('');
  const [description, setDescription] = useState(list?.description ?? '');
  const [isPublic, setIsPublic] = useState(list?.isPublic ?? false);
  const [error, setError] = useState<string | null>(null);

  const createList = useCreateMailingList();
  const updateList = useUpdateMailingList();
  const pending = createList.isPending || updateList.isPending;

  const slug = slugInput !== '' ? slugInput : slugify(name);
  const slugError =
    !isEdit && slug !== '' && !isValidSlug(slug)
      ? 'Use lowercase letters, numbers and single hyphens.'
      : null;
  const canSave = name.trim() !== '' && !slugError && !pending;

  const save = async () => {
    if (!canSave) return;
    setError(null);
    try {
      if (list) {
        const updated = await updateList.mutateAsync({
          id: list.id,
          body: {
            name: name.trim(),
            description: description.trim() || null,
            isPublic,
          },
        });
        onSaved(updated, false);
      } else {
        const created = await createList.mutateAsync({
          name: name.trim(),
          ...(slug ? { slug } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          isPublic,
        });
        onSaved(created, true);
      }
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  };

  return (
    <Dialog
      open
      onClose={pending ? undefined : onClose}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle sx={{ fontWeight: 700 }}>
        {isEdit ? 'Edit mailing list' : 'New mailing list'}
      </DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          spacing={2}
          sx={{ mt: 1 }}
          onSubmit={event => {
            event.preventDefault();
            void save();
          }}
        >
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            size="small"
            required
            autoFocus
            fullWidth
            value={name}
            onChange={event => setName(event.target.value)}
            slotProps={{
              htmlInput: { maxLength: MAILING_LIST_NAME_MAX_LENGTH },
            }}
          />
          {isEdit ? (
            // The slug is in embed snippets and subscribe links already out
            // in the world, so it cannot change after creation.
            <TextField
              label="Slug"
              size="small"
              fullWidth
              value={list.slug}
              disabled
              helperText="The slug is fixed once the list exists."
            />
          ) : (
            <TextField
              label="Slug"
              size="small"
              fullWidth
              value={slug}
              onChange={event => setSlugInput(event.target.value.toLowerCase())}
              error={!!slugError}
              helperText={
                slugError ??
                'Used in subscribe links and embeds. Suggested from the name.'
              }
              slotProps={{
                htmlInput: { maxLength: MAILING_LIST_SLUG_MAX_LENGTH },
              }}
            />
          )}
          <TextField
            label="Description"
            size="small"
            fullWidth
            multiline
            minRows={2}
            maxRows={5}
            value={description}
            onChange={event => setDescription(event.target.value)}
            helperText="Shown to people on the sign-up form."
            slotProps={{
              htmlInput: { maxLength: MAILING_LIST_DESCRIPTION_MAX_LENGTH },
            }}
          />
          <div>
            <FormControlLabel
              control={
                <Switch
                  checked={isPublic}
                  onChange={event => setIsPublic(event.target.checked)}
                />
              }
              label="Public — people can subscribe themselves"
            />
            <Typography
              sx={{ color: 'text.secondary', fontSize: '0.75rem', ml: 6 }}
            >
              Public lists appear on the sign-up form and can be embedded on
              other sites. Private lists are filled by admins only.
            </Typography>
          </div>
          {/* Lets Enter submit without a visible second button. */}
          <button type="submit" hidden />
        </Stack>
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
          onClick={save}
          disabled={!canSave}
          startIcon={
            pending ? <CircularProgress size={14} color="inherit" /> : undefined
          }
        >
          {isEdit ? 'Save changes' : 'Create list'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MailingListFormDialog;
