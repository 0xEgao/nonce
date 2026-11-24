import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  CloudCheck,
  CloudOff,
  Copy,
  EllipsisVertical,
  FlaskConical,
  Send,
  Trash2,
} from 'lucide-react';
import {
  type NewsletterDetailResponse,
  NewsletterContentFormat,
  type NewsletterPreviewResponse,
  type PreviewNewsletterRequest,
} from '@nonce/shared';
import {
  useDeleteNewsletter,
  useDuplicateNewsletter,
  useNewsletterSettings,
  usePreviewNewsletter,
  useSendNewsletter,
} from '../../../hooks/newsletterHooks';
import { useDebounce } from '../../../hooks/useDebounce';
import { formatDateTime } from '../../../utils/dateUtils';
import AudiencePicker from './AudiencePicker';
import ConfirmDialog from './ConfirmDialog';
import EmailPreview from './EmailPreview';
import NewsletterStatusChip from '../shared/NewsletterStatusChip';
import RichTextEditor from '../editor/RichTextEditor';
import SendDialog from './SendDialog';
import SendTestDialog from './SendTestDialog';
import {
  apiErrorMessage,
  type DraftFields,
  draftFieldsFrom,
  EMAIL_MAX_LENGTH,
  isValidEmail,
  normalizeEmail,
  parseEmailList,
  PREHEADER_MAX_LENGTH,
  SUBJECT_MAX_LENGTH,
  toUpdateBody,
} from './newsletterUtils';
import { type SaveState, useNewsletterAutosave } from './useNewsletterAutosave';

const HtmlEditor = lazy(() => import('../editor/HtmlEditor'));

const PREVIEW_DELAY_MS = 600;

// Seeded into HTML mode when there is nothing to keep, so the admin starts
// from a document rather than a blank page.
const HTML_SKELETON = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title></title>
</head>
<body style="margin:0; padding:24px; background-color:#111111; color:#eaeaea; font-family:system-ui, -apple-system, 'Segoe UI', sans-serif;">
  <p>Hello {{name}},</p>
</body>
</html>
`;

const isBlankContent = (content: string) =>
  !content.trim() || content === HTML_SKELETON;

type Pending = 'test' | 'send' | 'duplicate' | null;

interface Props {
  newsletter: NewsletterDetailResponse;
}

/**
 * The DRAFT editor. Seeds its fields from `newsletter` once and owns them from
 * then on; later cache updates (autosave responses) are not read back, so they
 * can never overwrite what is being typed.
 */
const NewsletterComposer = ({ newsletter }: Props) => {
  const navigate = useNavigate();
  const newsletterId = newsletter.id;
  const [fields, setFields] = useState<DraftFields>(() =>
    draftFieldsFrom(newsletter)
  );
  const adHoc = useMemo(
    () => parseEmailList(fields.adHocText),
    [fields.adHocText]
  );
  const body = useMemo(() => toUpdateBody(fields), [fields]);
  const autosave = useNewsletterAutosave(newsletterId, body);
  const { data: settings } = useNewsletterSettings();

  const setField = useCallback(
    <K extends keyof DraftFields>(key: K, value: DraftFields[K]) =>
      setFields(current =>
        current[key] === value ? current : { ...current, [key]: value }
      ),
    []
  );
  const setContent = useCallback(
    (content: string) => setField('content', content),
    [setField]
  );

  // ---- editor mode ----

  const [editorKey, setEditorKey] = useState(0);
  const [emitOnCreate, setEmitOnCreate] = useState(false);
  const [confirmVisual, setConfirmVisual] = useState(false);

  const showVisualEditor = (fromHtml: boolean) => {
    setEmitOnCreate(fromHtml);
    setEditorKey(k => k + 1);
  };

  const switchFormat = (next: NewsletterContentFormat) => {
    if (next === fields.contentFormat) return;
    if (next === NewsletterContentFormat.HTML) {
      setFields(f => ({
        ...f,
        contentFormat: next,
        content: f.content.trim() ? f.content : HTML_SKELETON,
      }));
      return;
    }
    if (isBlankContent(fields.content)) {
      setFields(f => ({ ...f, contentFormat: next, content: '' }));
      showVisualEditor(false);
      return;
    }
    setConfirmVisual(true);
  };

  // ---- live preview ----

  const previewRequest = useMemo<PreviewNewsletterRequest>(
    () => ({
      ...(fields.subject.trim() ? { subject: fields.subject.trim() } : {}),
      preheader: fields.preheader.trim() || null,
      contentFormat: fields.contentFormat,
      content: fields.content,
    }),
    [fields.subject, fields.preheader, fields.contentFormat, fields.content]
  );
  const debouncedPreview = useDebounce(previewRequest, PREVIEW_DELAY_MS);
  const { mutate: runPreview, isPending: previewPending } =
    usePreviewNewsletter();
  const [preview, setPreview] = useState<NewsletterPreviewResponse | null>(
    null
  );
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    // Only the latest call's callbacks fire, so a slow earlier render cannot
    // replace a newer one.
    runPreview(
      { id: newsletterId, body: debouncedPreview },
      {
        onSuccess: data => {
          setPreview(data);
          setPreviewError(null);
        },
        onError: e => setPreviewError(apiErrorMessage(e)),
      }
    );
  }, [debouncedPreview, newsletterId, runPreview]);

  // ---- actions ----

  const [toast, setToast] = useState<{
    kind: 'success' | 'error';
    msg: string;
  } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const sendNewsletter = useSendNewsletter();
  const duplicateNewsletter = useDuplicateNewsletter();
  const deleteNewsletter = useDeleteNewsletter();

  const replyToInvalid =
    !!fields.replyTo.trim() && !isValidEmail(normalizeEmail(fields.replyTo));

  const problems = useMemo(() => {
    const list: string[] = [];
    if (!fields.subject.trim()) list.push('Add a subject.');
    if (isBlankContent(fields.content)) list.push('Write the email.');
    if (fields.listIds.length === 0 && adHoc.valid.length === 0) {
      list.push('Pick a mailing list or add an address.');
    }
    if (replyToInvalid) list.push('Fix the reply-to address or clear it.');
    return list;
  }, [fields, adHoc.valid.length, replyToInvalid]);

  // Test sends, sends and copies all read the stored newsletter, so the last
  // edits have to be saved first.
  const afterSaving = async (
    action: Exclude<Pending, null>,
    then: () => void
  ) => {
    setPending(action);
    setToast(null);
    const saveError = await autosave.flush();
    setPending(null);
    if (saveError) {
      setToast({
        kind: 'error',
        msg: `Couldn't save your latest changes: ${saveError}`,
      });
      return;
    }
    then();
  };

  const confirmSend = async (scheduledAt?: string) => {
    autosave.lock();
    try {
      await sendNewsletter.mutateAsync({
        id: newsletterId,
        body: scheduledAt ? { scheduledAt } : {},
      });
    } catch (e) {
      autosave.unlock();
      throw e;
    }
  };

  const duplicate = () =>
    afterSaving('duplicate', async () => {
      try {
        const copy = await duplicateNewsletter.mutateAsync({
          id: newsletterId,
        });
        navigate(`/admin/newsletter/${copy.id}`);
      } catch (e) {
        setToast({ kind: 'error', msg: apiErrorMessage(e) });
      }
    });

  const confirmDelete = async () => {
    autosave.lock();
    try {
      await deleteNewsletter.mutateAsync({ id: newsletterId });
      navigate('/admin/newsletter', { replace: true });
    } catch (e) {
      autosave.unlock();
      throw e;
    }
  };

  const busy = pending !== null;

  return (
    <>
      {toast && (
        <Alert
          severity={toast.kind}
          sx={{ mb: 2 }}
          onClose={() => setToast(null)}
        >
          {toast.msg}
        </Alert>
      )}

      {/* ---- header ---- */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 3 }}
      >
        <Stack
          direction="row"
          spacing={1.25}
          alignItems="center"
          sx={{ minWidth: 0 }}
        >
          <NewsletterStatusChip status={newsletter.status} />
          <Typography
            variant="h6"
            title={fields.subject}
            sx={{
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {fields.subject.trim() || 'Untitled newsletter'}
          </Typography>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          sx={{ rowGap: 1, flexShrink: 0 }}
        >
          <SaveIndicator
            state={autosave.state}
            error={autosave.error}
            savedAt={newsletter.updatedAt}
            onRetry={() => void autosave.flush()}
          />
          <Button
            variant="outlined"
            startIcon={
              pending === 'test' ? (
                <CircularProgress size={14} />
              ) : (
                <FlaskConical size={14} />
              )
            }
            disabled={busy}
            onClick={() => afterSaving('test', () => setTestOpen(true))}
            sx={{ color: 'text.primary', borderColor: 'divider' }}
          >
            Send test
          </Button>
          <Button
            variant="contained"
            startIcon={
              pending === 'send' ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <Send size={14} />
              )
            }
            disabled={busy}
            onClick={() => afterSaving('send', () => setSendOpen(true))}
          >
            Send…
          </Button>
          <IconButton
            aria-label="More actions"
            onClick={e => setMenuAnchor(e.currentTarget)}
            disabled={busy}
            sx={{ color: 'text.secondary' }}
          >
            {pending === 'duplicate' ? (
              <CircularProgress size={16} />
            ) : (
              <EllipsisVertical size={18} />
            )}
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={!!menuAnchor}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                void duplicate();
              }}
            >
              <ListItemIcon>
                <Copy size={15} />
              </ListItemIcon>
              Duplicate
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                setDeleteOpen(true);
              }}
              sx={{ color: 'error.main' }}
            >
              <ListItemIcon sx={{ color: 'inherit' }}>
                <Trash2 size={15} />
              </ListItemIcon>
              Delete draft
            </MenuItem>
          </Menu>
        </Stack>
      </Stack>

      {/* ---- form + preview ---- */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 3,
          alignItems: 'start',
          // Side by side only where the 600px email fits in each column.
          '@media (min-width: 1440px)': {
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          },
        }}
      >
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          <Section title="Details">
            <Stack spacing={2}>
              <TextField
                label="Subject"
                size="small"
                fullWidth
                required
                value={fields.subject}
                onChange={e => setField('subject', e.target.value)}
                error={!fields.subject.trim()}
                helperText={
                  !fields.subject.trim()
                    ? 'A subject is required.'
                    : settings
                      ? `From ${settings.fromName} <${settings.fromEmail}>`
                      : ' '
                }
                slotProps={{ htmlInput: { maxLength: SUBJECT_MAX_LENGTH } }}
              />
              <TextField
                label="Preview text"
                size="small"
                fullWidth
                value={fields.preheader}
                onChange={e => setField('preheader', e.target.value)}
                helperText="Shown after the subject in most inboxes."
                slotProps={{
                  htmlInput: { maxLength: PREHEADER_MAX_LENGTH },
                }}
              />
              <TextField
                label="Reply-to"
                size="small"
                fullWidth
                value={fields.replyTo}
                onChange={e => setField('replyTo', e.target.value)}
                error={replyToInvalid}
                helperText={
                  replyToInvalid
                    ? 'Not a valid email address; it will not be saved.'
                    : `Optional. Leave blank to use ${settings?.replyTo ?? 'the default reply-to address'}.`
                }
                slotProps={{ htmlInput: { maxLength: EMAIL_MAX_LENGTH } }}
              />
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={fields.trackingEnabled}
                      onChange={e =>
                        setField('trackingEnabled', e.target.checked)
                      }
                    />
                  }
                  label="Track opens and clicks"
                />
                <Typography
                  variant="caption"
                  component="p"
                  sx={{ color: 'text.secondary', ml: 0.5 }}
                >
                  Adds an invisible pixel and routes links through the portal so
                  the report can count opens and clicks.
                </Typography>
              </Box>
            </Stack>
          </Section>

          <Section title="Audience">
            <AudiencePicker
              listIds={fields.listIds}
              onListIdsChange={ids => setField('listIds', ids)}
              adHocText={fields.adHocText}
              onAdHocTextChange={text => setField('adHocText', text)}
              adHoc={adHoc}
            />
          </Section>

          <Section
            title="Content"
            action={
              <ToggleButtonGroup
                size="small"
                exclusive
                value={fields.contentFormat}
                onChange={(_, next: NewsletterContentFormat | null) =>
                  next && switchFormat(next)
                }
                aria-label="Editor"
              >
                <ToggleButton
                  value={NewsletterContentFormat.RICH_TEXT}
                  sx={{ px: 1.5, py: 0.25, fontSize: '0.78rem' }}
                >
                  Visual
                </ToggleButton>
                <ToggleButton
                  value={NewsletterContentFormat.HTML}
                  sx={{ px: 1.5, py: 0.25, fontSize: '0.78rem' }}
                >
                  HTML
                </ToggleButton>
              </ToggleButtonGroup>
            }
          >
            {fields.contentFormat === NewsletterContentFormat.HTML ? (
              <Stack spacing={1.5}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  A complete HTML document, sent exactly as written: the
                  Bitshala layout is not added. Merge tags still work, and
                  without {'{{unsubscribe_url}}'} the standard footer is
                  appended.
                </Typography>
                <Suspense
                  fallback={
                    <Box
                      sx={{ display: 'flex', justifyContent: 'center', py: 8 }}
                    >
                      <CircularProgress size={22} />
                    </Box>
                  }
                >
                  <HtmlEditor value={fields.content} onChange={setContent} />
                </Suspense>
              </Stack>
            ) : (
              <RichTextEditor
                key={editorKey}
                initialContent={fields.content}
                onChange={setContent}
                emitOnCreate={emitOnCreate}
              />
            )}
          </Section>
        </Stack>

        <Box
          sx={{
            minWidth: 0,
            '@media (min-width: 1440px)': { position: 'sticky', top: 16 },
          }}
        >
          <EmailPreview
            subject={preview?.subject ?? null}
            preheader={fields.preheader.trim() || null}
            html={preview?.html ?? null}
            loading={previewPending}
            error={previewError}
            height="calc(100vh - 200px)"
          />
        </Box>
      </Box>

      <ConfirmDialog
        open={confirmVisual}
        title="Switch to the visual editor?"
        confirmLabel="Switch and drop the rest"
        destructive
        onClose={() => setConfirmVisual(false)}
        onConfirm={async () => {
          setFields(f => ({
            ...f,
            contentFormat: NewsletterContentFormat.RICH_TEXT,
          }));
          showVisualEditor(true);
        }}
      >
        The visual editor keeps headings, paragraphs, lists, links, buttons,
        images, quotes and dividers. Everything else in this HTML (the head,
        styles, tables and layout) will be dropped.
      </ConfirmDialog>

      <SendTestDialog
        open={testOpen}
        newsletterId={newsletterId}
        onClose={() => setTestOpen(false)}
      />

      <SendDialog
        open={sendOpen}
        newsletterId={newsletterId}
        problems={problems}
        onClose={() => setSendOpen(false)}
        onConfirm={confirmSend}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this draft?"
        confirmLabel="Delete"
        destructive
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      >
        "{fields.subject.trim() || 'Untitled newsletter'}" will be deleted. This
        can't be undone.
      </ConfirmDialog>
    </>
  );
};

// ---- pieces ----

const Section = ({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <Box
    sx={{
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1,
      bgcolor: 'background.paper',
      p: { xs: 2, sm: 2.5 },
    }}
  >
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{ mb: 2, minHeight: 28 }}
    >
      <Typography
        sx={{
          fontSize: '0.7rem',
          letterSpacing: 0.8,
          fontWeight: 700,
          textTransform: 'uppercase',
          color: 'text.secondary',
        }}
      >
        {title}
      </Typography>
      {action}
    </Stack>
    {children}
  </Box>
);

const SaveIndicator = ({
  state,
  error,
  savedAt,
  onRetry,
}: {
  state: SaveState;
  error: string | null;
  savedAt: string;
  onRetry: () => void;
}) => {
  const text = { fontSize: '0.78rem', color: 'text.secondary' };
  if (state === 'saving') {
    return (
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 1 }}>
        <CircularProgress size={12} />
        <Typography sx={text}>Saving…</Typography>
      </Stack>
    );
  }
  if (state === 'error') {
    return (
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        title={error ?? undefined}
        sx={{ px: 1 }}
      >
        <Box sx={{ color: 'error.main', display: 'flex' }}>
          <CloudOff size={14} />
        </Box>
        <Typography sx={{ ...text, color: 'error.main' }}>
          Save failed
        </Typography>
        <Button size="small" onClick={onRetry} sx={{ minWidth: 0, px: 0.75 }}>
          Retry
        </Button>
      </Stack>
    );
  }
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      title={`Last saved ${formatDateTime(savedAt)}`}
      sx={{ px: 1 }}
    >
      <Box sx={{ color: 'text.secondary', display: 'flex' }}>
        <CloudCheck size={14} />
      </Box>
      <Typography sx={text}>
        {state === 'dirty' ? 'Unsaved changes' : 'Saved'}
      </Typography>
    </Stack>
  );
};

export default NewsletterComposer;
