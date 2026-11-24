import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { PublicMailingListResponse } from '@nonce/shared';
import {
  PublicShell,
  StatePanel,
} from '../../components/newsletter/public/PublicShell';
import {
  usePublicMailingLists,
  useSubscribe,
} from '../../hooks/newsletterHooks';
import { usePageMeta } from '../../hooks/usePageMeta';
import {
  extractErrorMessage,
  isAxiosError,
  isThrottledError,
} from '../../utils/errorUtils';

interface SubscribeProps {
  /** Rendered chromeless inside an iframe on bitshala.org (/embed/newsletter). */
  embed?: boolean;
}

const parseSlugs = (raw: string | null): string[] =>
  (raw ?? '')
    .split(',')
    .map(slug => slug.trim().toLowerCase())
    .filter(Boolean);

// Off-screen rather than display:none, which some bots detect and skip, and
// out of the tab order and the accessibility tree so people never meet it.
const HONEYPOT_STYLE = {
  position: 'absolute',
  left: '-10000px',
  width: 1,
  height: 1,
  overflow: 'hidden',
  opacity: 0,
} as const;

const Subscribe = ({ embed = false }: SubscribeProps) => {
  const [params] = useSearchParams();
  const requestedSlugs = parseSlugs(params.get('lists'));
  const theme = params.get('theme') === 'light' ? 'light' : 'dark';

  usePageMeta(
    'Subscribe to the newsletter',
    'Get Bitshala news and updates by email.'
  );

  const listsQuery = usePublicMailingLists();
  const subscribe = useSubscribe();

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  // Null until the person touches a box; until then the ?lists= choice rules.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const lists = listsQuery.data ?? [];
  const requested = lists.filter(list => requestedSlugs.includes(list.slug));
  // Exactly one list asked for and it exists: no picker, just that list.
  const single: PublicMailingListResponse | null =
    requestedSlugs.length === 1 && requested.length === 1 ? requested[0] : null;

  const defaultPick = new Set(
    single
      ? [single.id]
      : requested.length > 0
        ? requested.map(list => list.id)
        : lists.length === 1
          ? [lists[0].id]
          : []
  );
  const selection = picked ?? defaultPick;

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selection);
    if (checked) next.add(id);
    else next.delete(id);
    setPicked(next);
    setProblem(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const chosen = lists.filter(list => selection.has(list.id));
    if (chosen.length === 0) {
      setProblem('Pick at least one newsletter.');
      return;
    }
    try {
      await subscribe.mutateAsync({
        email: email.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        listSlugs: chosen.map(list => list.slug),
        website,
      });
    } catch {
      // Shown from `subscribe.error` below.
    }
  };

  const heading = single
    ? `Subscribe to ${single.name}`
    : 'Subscribe to the Bitshala newsletter';
  const intro = single
    ? single.description
    : 'Bitcoin education, cohort announcements and updates from Bitshala, in your inbox.';

  let body: ReactNode;
  if (listsQuery.isLoading) {
    body = (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={26} sx={{ color: '#fb923c' }} />
      </Box>
    );
  } else if (listsQuery.isError) {
    body = (
      <Alert
        severity="error"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => listsQuery.refetch()}
          >
            Retry
          </Button>
        }
      >
        {isThrottledError(listsQuery.error)
          ? 'Too many requests right now. Wait a moment and retry.'
          : `Couldn't load the newsletters: ${extractErrorMessage(listsQuery.error)}`}
      </Alert>
    );
  } else if (lists.length === 0) {
    body = (
      <Typography sx={{ color: 'text.secondary' }}>
        There are no newsletters open for sign-up right now. Please check back
        soon.
      </Typography>
    );
  } else if (subscribe.isSuccess) {
    body = (
      <StatePanel
        tone="success"
        title="Check your inbox"
        actions={
          <Button
            size="small"
            onClick={() => {
              subscribe.reset();
              setEmail('');
              setName('');
              setPicked(null);
            }}
            sx={{ color: 'text.secondary' }}
          >
            Use a different email
          </Button>
        }
      >
        {subscribe.data.message}
      </StatePanel>
    );
  } else {
    const submitError = subscribe.error;
    const status = isAxiosError(submitError)
      ? submitError.response?.status
      : undefined;
    body = (
      <Box component="form" onSubmit={submit}>
        <Stack spacing={2}>
          {!embed && intro && (
            <Typography sx={{ color: 'text.secondary', fontSize: '0.92rem' }}>
              {intro}
            </Typography>
          )}
          {embed && single && (
            <Box>
              <Typography sx={{ fontWeight: 700 }}>{single.name}</Typography>
              {single.description && (
                <Typography
                  sx={{ color: 'text.secondary', fontSize: '0.85rem' }}
                >
                  {single.description}
                </Typography>
              )}
            </Box>
          )}

          {submitError != null && (
            <Alert severity="error">
              {isThrottledError(submitError)
                ? 'Too many attempts. Please wait a moment and try again.'
                : status === 400
                  ? `Please check your details. ${extractErrorMessage(submitError)}`
                  : extractErrorMessage(submitError)}
            </Alert>
          )}

          <TextField
            label="Email"
            type="email"
            required
            fullWidth
            size="small"
            value={email}
            onChange={event => setEmail(event.target.value)}
            slotProps={{
              htmlInput: {
                autoComplete: 'email',
                inputMode: 'email',
                maxLength: 320,
              },
            }}
          />
          <TextField
            label="Name (optional)"
            fullWidth
            size="small"
            value={name}
            onChange={event => setName(event.target.value)}
            slotProps={{ htmlInput: { autoComplete: 'name', maxLength: 255 } }}
          />

          {!single && lists.length > 1 && (
            <Box
              component="fieldset"
              sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}
            >
              <Typography
                component="legend"
                sx={{ fontWeight: 600, fontSize: '0.88rem', mb: 0.5 }}
              >
                Which newsletters?
              </Typography>
              {lists.map(list => (
                <FormControlLabel
                  key={list.id}
                  sx={{ alignItems: 'flex-start', display: 'flex', m: 0 }}
                  control={
                    <Checkbox
                      checked={selection.has(list.id)}
                      onChange={event => toggle(list.id, event.target.checked)}
                      sx={{ pt: 0.5 }}
                    />
                  }
                  label={
                    <Box sx={{ pt: 0.5 }}>
                      <Typography sx={{ fontWeight: 600, fontSize: '0.9rem' }}>
                        {list.name}
                      </Typography>
                      {list.description && (
                        <Typography
                          sx={{ color: 'text.secondary', fontSize: '0.8rem' }}
                        >
                          {list.description}
                        </Typography>
                      )}
                    </Box>
                  }
                />
              ))}
            </Box>
          )}
          {/* One list in total and nothing in the URL: the single list is
              preselected, so say which one it is. */}
          {!single && lists.length === 1 && (
            <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
              You&apos;ll receive <strong>{lists[0].name}</strong>
              {lists[0].description ? `: ${lists[0].description}` : '.'}
            </Typography>
          )}

          {/* Honeypot: people never see or reach this field; bots fill in
              anything called "website". */}
          <Box aria-hidden="true" sx={HONEYPOT_STYLE}>
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={website}
              onChange={event => setWebsite(event.target.value)}
            />
          </Box>

          {problem && (
            <Typography
              role="alert"
              sx={{ color: 'error.main', fontSize: '0.85rem' }}
            >
              {problem}
            </Typography>
          )}

          <Box>
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={subscribe.isPending || email.trim() === ''}
              startIcon={
                subscribe.isPending ? (
                  <CircularProgress size={14} color="inherit" />
                ) : undefined
              }
              sx={{ py: 1.1 }}
            >
              Subscribe
            </Button>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: '0.75rem',
                mt: 1,
                textAlign: 'center',
              }}
            >
              We&apos;ll email you a link to confirm. Unsubscribe any time.
            </Typography>
          </Box>
        </Stack>
      </Box>
    );
  }

  return (
    <PublicShell
      embed={embed}
      theme={theme}
      title={!embed && !subscribe.isSuccess ? heading : undefined}
    >
      {body}
    </PublicShell>
  );
};

export default Subscribe;
