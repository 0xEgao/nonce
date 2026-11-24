/** `<iframe>` pointing at the chromeless sign-up page for one list. */
export const buildIframeSnippet = (
  origin: string,
  slug: string,
  theme: 'dark' | 'light'
): string => {
  const params = new URLSearchParams({ lists: slug });
  if (theme === 'light') params.set('theme', 'light');
  return [
    '<iframe',
    `  src="${origin}/embed/newsletter?${params.toString()}"`,
    '  title="Subscribe to the Bitshala newsletter"',
    '  width="100%"',
    '  height="300"',
    '  style="border:0;max-width:480px"',
    '  loading="lazy"',
    '></iframe>',
  ].join('\n');
};

/**
 * A plain HTML form plus an inline `fetch`, for sites that would rather style
 * the form themselves. No dependencies; it posts the same JSON the iframe page
 * does. The `website` input is the honeypot: people never see it, bots fill it
 * in, and the API then ignores the sign-up.
 */
export const buildFetchSnippet = (apiBaseUrl: string, slug: string): string => {
  const endpoint = `${apiBaseUrl.replace(/\/+$/, '')}/newsletter/public/subscribe`;
  return `<form id="bitshala-newsletter" style="max-width:420px;font-family:system-ui,sans-serif">
  <input type="text" name="name" placeholder="Your name (optional)" autocomplete="name" style="display:block;width:100%;margin-bottom:8px;padding:10px;box-sizing:border-box">
  <input type="email" name="email" placeholder="you@example.com" required autocomplete="email" style="display:block;width:100%;margin-bottom:8px;padding:10px;box-sizing:border-box">
  <!-- Honeypot: keep it, but out of sight. -->
  <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
  <button type="submit" style="padding:10px 18px;cursor:pointer">Subscribe</button>
  <p id="bitshala-newsletter-message" role="status" style="margin:8px 0 0"></p>
</form>
<script>
  (function () {
    var form = document.getElementById('bitshala-newsletter');
    var message = document.getElementById('bitshala-newsletter-message');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var fields = new FormData(form);
      var button = form.querySelector('button');
      button.disabled = true;
      message.textContent = '';
      fetch(${JSON.stringify(endpoint)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: fields.get('email'),
          name: fields.get('name') || undefined,
          listSlugs: [${JSON.stringify(slug)}],
          website: fields.get('website') || ''
        })
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (data) {
            if (!response.ok) throw new Error(data.message || 'Something went wrong.');
            return data;
          });
        })
        .then(function (data) {
          message.textContent = data.message;
          form.reset();
        })
        .catch(function (error) {
          message.textContent = error.message || 'Something went wrong. Please try again.';
        })
        .then(function () {
          button.disabled = false;
        });
    });
  })();
</script>`;
};
