import { Extension } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';

/**
 * Marks a link as a call-to-action button: `<a data-button="true">`, which the
 * email layout styles as a button. An attribute on StarterKit's own link mark
 * rather than a second mark, so a button is still a link to every link command
 * and survives a getHTML / setContent round trip.
 */
const ButtonLink = Extension.create({
  name: 'buttonLink',
  addGlobalAttributes() {
    return [
      {
        types: ['link'],
        attributes: {
          button: {
            default: false,
            parseHTML: element =>
              element.getAttribute('data-button') === 'true',
            renderHTML: attributes =>
              attributes.button ? { 'data-button': 'true' } : {},
          },
        },
      },
    ];
  },
});

/**
 * Limited to what the email layout styles: h1-h3, p, a (and the button), lists,
 * blockquote, hr, img, strong/em/u/s, inline code, text-align. Code blocks are
 * off; hard breaks stay, as a plain <br> every client renders.
 */
export const buildNewsletterExtensions = (placeholder: string) => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
    link: {
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: 'https',
      HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
    },
  }),
  ButtonLink,
  Image.configure({ inline: false, allowBase64: false }),
  TextAlign.configure({
    types: ['heading', 'paragraph'],
    alignments: ['left', 'center', 'right'],
  }),
  Placeholder.configure({ placeholder }),
];
