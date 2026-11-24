import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  type NewsletterDetailResponse,
  NewsletterStatus,
  type UpdateNewsletterRequest,
} from '@nonce/shared';
import {
  newsletterKeys,
  useUpdateNewsletter,
} from '../../../hooks/newsletterHooks';
import { isAxiosError } from '../../../utils/errorUtils';
import { apiErrorMessage } from '../shared/newsletterUtils';
import { diffUpdateBody } from './composerUtils';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const AUTOSAVE_DELAY_MS = 1200;

/**
 * Debounced PATCH of whatever in `body` differs from what was last saved.
 *
 * Saves run one at a time through a promise chain, and each one diffs at the
 * moment it runs, so edits made while a save is in flight go out in the next.
 * `flush()` saves now and resolves to the error message if that failed (null
 * when everything is saved); the send, test and schedule actions call it
 * first. `lock()` stops all further saves: once a send starts the newsletter
 * is no longer a draft and a PATCH would only 409.
 */
export const useNewsletterAutosave = (
  newsletterId: string,
  body: UpdateNewsletterRequest
) => {
  const queryClient = useQueryClient();
  const { mutateAsync } = useUpdateNewsletter();
  const [state, setState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);

  const savedRef = useRef(body);
  const bodyRef = useRef(body);
  const lockedRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const queueRef = useRef<Promise<string | null>>(Promise.resolve(null));
  const mutateRef = useRef(mutateAsync);

  useEffect(() => {
    mutateRef.current = mutateAsync;
  }, [mutateAsync]);

  const runSave = useCallback(async (): Promise<string | null> => {
    if (lockedRef.current) return 'This newsletter is no longer a draft.';
    const diff = diffUpdateBody(savedRef.current, bodyRef.current);
    if (!diff) {
      setState('saved');
      return null;
    }
    setState('saving');
    try {
      await mutateRef.current({ id: newsletterId, body: diff });
      // What was sent, not the response: the server may normalise values
      // (lowercased addresses), and comparing against those would re-save.
      savedRef.current = { ...savedRef.current, ...diff };
      setError(null);
      setState(
        diffUpdateBody(savedRef.current, bodyRef.current) ? 'dirty' : 'saved'
      );
      return null;
    } catch (e) {
      const message = apiErrorMessage(e);
      setError(message);
      setState('error');
      const status = isAxiosError(e) ? e.response?.status : undefined;
      // 409: no longer a draft (sent or scheduled elsewhere). 404: deleted.
      // Either way stop saving and let the page reload what is there now.
      if (status === 409 || status === 404) {
        lockedRef.current = true;
        void queryClient.invalidateQueries({
          queryKey: newsletterKeys.newsletter(newsletterId),
        });
      }
      return message;
    }
  }, [newsletterId, queryClient]);

  const save = useCallback(() => {
    const next = queueRef.current.then(runSave, runSave);
    queueRef.current = next;
    return next;
  }, [runSave]);

  useEffect(() => {
    bodyRef.current = body;
    if (lockedRef.current) return;
    if (!diffUpdateBody(savedRef.current, body)) return;
    setState(current => (current === 'saving' ? current : 'dirty'));
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  }, [body, save]);

  // Leaving the page with an edit still waiting on the debounce saves it, as
  // long as the cached newsletter says it is still a draft.
  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
      if (lockedRef.current) return;
      if (!diffUpdateBody(savedRef.current, bodyRef.current)) return;
      const cached = queryClient.getQueryData<NewsletterDetailResponse>(
        newsletterKeys.newsletter(newsletterId)
      );
      if (cached?.status === NewsletterStatus.DRAFT) void save();
    },
    [newsletterId, queryClient, save]
  );

  // The browser's own "leave site?" prompt while an edit is unsaved.
  useEffect(() => {
    if (state === 'saved') return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);

  const flush = useCallback(() => {
    window.clearTimeout(timerRef.current);
    return save();
  }, [save]);

  const lock = useCallback(() => {
    window.clearTimeout(timerRef.current);
    lockedRef.current = true;
  }, []);

  const unlock = useCallback(() => {
    lockedRef.current = false;
  }, []);

  return { state, error, flush, lock, unlock };
};
