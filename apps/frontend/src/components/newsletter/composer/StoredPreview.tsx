import { useEffect } from 'react';
import { usePreviewNewsletter } from '../../../hooks/newsletterHooks';
import { apiErrorMessage } from './newsletterUtils';
import EmailPreview from './EmailPreview';

interface Props {
  newsletterId: string;
  preheader: string | null;
  height?: number | string;
}

/** The stored newsletter as the server renders it, fetched once on mount. */
const StoredPreview = ({ newsletterId, preheader, height }: Props) => {
  const { mutate, data, error, isPending } = usePreviewNewsletter();

  useEffect(() => {
    mutate({ id: newsletterId, body: {} });
  }, [mutate, newsletterId]);

  return (
    <EmailPreview
      subject={data?.subject ?? null}
      preheader={preheader}
      html={data?.html ?? null}
      loading={isPending}
      error={error ? apiErrorMessage(error) : null}
      height={height}
    />
  );
};

export default StoredPreview;
