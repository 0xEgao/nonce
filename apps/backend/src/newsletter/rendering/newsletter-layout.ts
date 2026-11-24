import { escapeHtml } from '@/newsletter/newsletter.utils';

// The Bitshala email look (see assets/mail-templates/*.html.eta), as code
// rather than an asset file: the build's asset copy is not reliable, and
// these are tiny. Everything here is a plain string template; admin content
// is dropped in verbatim and never evaluated.

const FONT_STACK =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// Class on the hidden preview text, so the plain-text part can leave it out.
export const PREHEADER_CLASS = 'nl-preheader';

// Styles for what the rich-text editor emits, scoped to the content cell.
// juice inlines them; the media query is kept in a <style> for clients that
// honour it.
export const NEWSLETTER_CONTENT_CSS = `
.nl-content h1 { margin: 0 0 16px 0; font-size: 26px; line-height: 1.3; font-weight: 700; color: #ffffff; }
.nl-content h2 { margin: 28px 0 12px 0; font-size: 21px; line-height: 1.35; font-weight: 700; color: #ffffff; }
.nl-content h3 { margin: 24px 0 10px 0; font-size: 17px; line-height: 1.4; font-weight: 600; color: #ffd580; }
.nl-content p { margin: 0 0 16px 0; }
.nl-content a { color: #f9b233; text-decoration: underline; }
.nl-content a[data-button] { display: inline-block; padding: 12px 28px; border-radius: 999px; background-color: #f7931a; color: #000000; font-size: 15px; font-weight: 600; line-height: 1.2; text-decoration: none; }
.nl-content ul { margin: 0 0 16px 0; padding: 0 0 0 24px; }
.nl-content ol { margin: 0 0 16px 0; padding: 0 0 0 24px; }
.nl-content li { margin: 0 0 6px 0; }
.nl-content li p { margin: 0; }
.nl-content blockquote { margin: 0 0 16px 0; padding: 12px 16px; border-left: 3px solid #f9b233; background-color: #2a2200; color: #eaeaea; }
.nl-content blockquote p { margin: 0 0 8px 0; }
.nl-content hr { height: 0; margin: 24px 0; border: 0; border-top: 1px solid #333333; }
.nl-content img { display: block; max-width: 100%; height: auto; margin: 0 auto 16px auto; border: 0; border-radius: 8px; }
.nl-content strong { font-weight: 700; }
.nl-content em { font-style: italic; }
.nl-content u { text-decoration: underline; }
.nl-content s { text-decoration: line-through; }
.nl-content code { padding: 2px 5px; border-radius: 4px; background-color: #2b2b2b; color: #ffd580; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
.nl-content pre { margin: 0 0 16px 0; padding: 12px 14px; border-radius: 8px; background-color: #0d0d0d; white-space: pre-wrap; word-break: break-word; }
.nl-content pre code { padding: 0; background-color: transparent; }
@media only screen and (max-width: 620px) {
  .nl-outer { padding: 16px 8px !important; }
  .nl-content { padding: 24px 20px !important; }
  .nl-footer { padding: 16px 20px 24px 20px !important; }
}
`;

/** Inbox preview text: hidden, padded so body text does not trail it. */
export function preheaderHtml(preheader: string): string {
    return (
        `<div class="${PREHEADER_CLASS}" style="display:none; max-height:0; max-width:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#111111; opacity:0;">` +
        escapeHtml(preheader) +
        '&#847;&zwnj;&nbsp;'.repeat(40) +
        '</div>'
    );
}

/**
 * The rich-text newsletter document, before CSS inlining. `contentHtml` and
 * `footerHtml` go in verbatim; `title` is escaped here.
 */
export function richTextDocument(parts: {
    title: string;
    preheaderHtml: string;
    contentHtml: string;
    footerHtml: string | null;
}): string {
    const footerRow = parts.footerHtml
        ? `
          <tr>
            <td class="nl-footer" style="padding:20px 36px 28px 36px; border-top:1px solid #2a2a2a; font-family:${FONT_STACK}; font-size:12px; line-height:1.6; color:#b3b3b3; text-align:left;">
${parts.footerHtml}
            </td>
          </tr>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <style data-embed>
    :root { color-scheme: dark; supported-color-schemes: dark; }
  </style>
  <style>${NEWSLETTER_CONTENT_CSS}</style>
  <title>${escapeHtml(parts.title)}</title>
</head>
<body bgcolor="#111111" style="margin:0; padding:0; background-color:#111111; font-family:${FONT_STACK};">
${parts.preheaderHtml}
  <table bgcolor="#111111" role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#111111;">
    <tr>
      <td class="nl-outer" align="center" style="padding:32px 12px;">
        <table bgcolor="#1b1b1b" role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" style="width:100%; max-width:600px; background-color:#1b1b1b; border-radius:16px; overflow:hidden;">
          <tr>
            <td bgcolor="#000000" align="center" style="background-color:#000000; padding:20px 24px;">
              <span style="font-family:${FONT_STACK}; font-size:18px; font-weight:700; letter-spacing:3px; color:#f7931a;">BITSHALA</span>
            </td>
          </tr>
          <tr>
            <td class="nl-content" style="padding:32px 36px; font-family:${FONT_STACK}; font-size:15px; line-height:1.65; color:#eaeaea; text-align:left; word-break:break-word;">
${parts.contentHtml}
            </td>
          </tr>${footerRow}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

// The footer links are merge tags, resolved per recipient like any other, so
// they never end up in the tracked-link list.
function footerParagraphs(
    postalAddress: string | null,
    linkStyle: string,
    addressStyle: string,
): string {
    const address = postalAddress
        ? `\n<p style="margin:10px 0 0 0; ${addressStyle}">${escapeHtml(postalAddress).replace(/\r?\n/g, '<br />')}</p>`
        : '';
    return (
        `<p style="margin:0 0 8px 0;">You're receiving this because you subscribed to updates from Bitshala or took part in one of its programs.</p>\n` +
        `<p style="margin:0;"><a href="{{unsubscribe_url}}" style="${linkStyle}">Unsubscribe</a> &nbsp;&middot;&nbsp; <a href="{{preferences_url}}" style="${linkStyle}">Manage preferences</a></p>` +
        address
    );
}

/** Footer row content for the rich-text layout. */
export function layoutFooterHtml(postalAddress: string | null): string {
    return footerParagraphs(
        postalAddress,
        'color:#f9b233; text-decoration:underline;',
        'color:#8a8a8a;',
    );
}

/**
 * Footer for admin-authored HTML, which can have any background: neutral grey
 * on both light and dark.
 */
export function standaloneFooterHtml(postalAddress: string | null): string {
    return `
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
  <tr>
    <td align="center" style="padding:24px 16px; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:1.6; color:#888888; text-align:center;">
${footerParagraphs(postalAddress, 'color:#888888; text-decoration:underline;', 'color:#888888;')}
    </td>
  </tr>
</table>
`;
}
