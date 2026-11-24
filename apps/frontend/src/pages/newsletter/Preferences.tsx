import { useSearchParams } from 'react-router-dom';
import {
  PublicShell,
  StatePanel,
} from '../../components/newsletter/PublicShell';
import EmailPreferences from '../../components/newsletter/EmailPreferences';
import { PREVIEW_TOKEN } from '../../components/newsletter/newsletterUtils';
import { usePageMeta } from '../../hooks/usePageMeta';

const Preferences = () => {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  usePageMeta('Email preferences');

  if (!token) {
    return (
      <PublicShell>
        <StatePanel tone="error" title="This link is incomplete">
          Open the &ldquo;Manage preferences&rdquo; link in a Bitshala email
          again.
        </StatePanel>
      </PublicShell>
    );
  }

  if (token === PREVIEW_TOKEN) {
    return (
      <PublicShell>
        <StatePanel tone="info" title="This is a preview link">
          Real newsletter emails get a working preferences link. Nothing was
          changed.
        </StatePanel>
      </PublicShell>
    );
  }

  return (
    <PublicShell title="Email preferences">
      <EmailPreferences token={token} />
    </PublicShell>
  );
};

export default Preferences;
