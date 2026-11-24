import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  type Editor,
  EditorContent,
  useEditor,
  useEditorState,
} from '@tiptap/react';
import { Box, IconButton, MenuItem, TextField, Tooltip } from '@mui/material';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  RectangleHorizontal,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
} from 'lucide-react';
import { fontFamilyMono } from '../../fellowship/theme';
import { buildNewsletterExtensions } from './editorExtensions';
import ImageDialog, { type ImageDraft, type ImageResult } from './ImageDialog';
import LinkDialog, { type LinkDraft, type LinkResult } from './LinkDialog';
import MergeTagMenu from './MergeTagMenu';
import type { MergeTag } from '../composer/newsletterUtils';

// The email layout's palette (see the backend mail templates), so the editing
// surface reads like the email it becomes. The preview pane stays the source
// of truth; this is an approximation.
const EMAIL = {
  page: '#111111',
  card: '#1b1b1b',
  text: '#eaeaea',
  muted: '#b3b3b3',
  heading: '#ffffff',
  accent: '#f9b233',
  rule: '#333333',
};

const EMAIL_FONT =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/** An empty document is '' rather than '<p></p>', so "no content" stays checkable. */
const serialize = (editor: Editor) => (editor.isEmpty ? '' : editor.getHTML());

interface Props {
  initialContent: string;
  onChange: (html: string) => void;
  /**
   * Report the parsed content as soon as the editor exists. Set after a switch
   * from HTML: the editor drops what it cannot hold, and the stored content
   * has to match what the editor shows before anything is saved.
   */
  emitOnCreate?: boolean;
}

/** TipTap editor for RICH_TEXT newsletters. Uncontrolled after mount. */
const RichTextEditor = ({
  initialContent,
  onChange,
  emitOnCreate = false,
}: Props) => {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: buildNewsletterExtensions('Write your newsletter…'),
    content: initialContent,
    onCreate: ({ editor: created }) => {
      if (emitOnCreate) onChangeRef.current(serialize(created));
    },
    onUpdate: ({ editor: updated }) => onChangeRef.current(serialize(updated)),
    editorProps: {
      attributes: { 'aria-label': 'Newsletter content', spellcheck: 'true' },
    },
  });

  const draftKey = useRef(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);

  const openLinkDialog = (asButton: boolean) => {
    const { empty, from, to } = editor.state.selection;
    const onLink = editor.isActive('link');
    const attrs = editor.getAttributes('link');
    draftKey.current += 1;
    setLinkDraft({
      key: draftKey.current,
      href: onLink ? (attrs.href ?? '') : '',
      text: editor.state.doc.textBetween(from, to, ' '),
      button: onLink ? !!attrs.button : asButton,
      askText: empty && !onLink,
      editing: onLink,
    });
    setLinkOpen(true);
  };

  const saveLink = ({ href, text, button }: LinkResult) => {
    setLinkOpen(false);
    if (!linkDraft) return;
    const attrs = { href, button };
    const chain = editor.chain().focus();
    if (linkDraft.editing) {
      chain.extendMarkRange('link').setMark('link', attrs).run();
      return;
    }
    if (!linkDraft.askText) {
      chain.setMark('link', attrs).run();
      return;
    }
    const linkText = {
      type: 'text',
      text: text || href,
      marks: [{ type: 'link', attrs }],
    };
    // unsetMark drops the stored mark, so typing after the insert is plain text.
    if (button) {
      chain
        .insertContent({
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [linkText],
        })
        .unsetMark('link')
        .run();
    } else {
      chain.insertContent(linkText).unsetMark('link').run();
    }
  };

  const removeLink = () => {
    setLinkOpen(false);
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
  };

  const openImageDialog = () => {
    const editing = editor.isActive('image');
    const attrs = editing ? editor.getAttributes('image') : {};
    draftKey.current += 1;
    setImageDraft({
      key: draftKey.current,
      src: attrs.src ?? '',
      alt: attrs.alt ?? '',
      editing,
    });
    setImageOpen(true);
  };

  const saveImage = ({ src, alt }: ImageResult) => {
    setImageOpen(false);
    if (imageDraft?.editing) {
      editor
        .chain()
        .focus()
        .updateAttributes('image', { src, alt: alt || null })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .setImage({ src, ...(alt ? { alt } : {}) })
        .run();
    }
  };

  const insertMergeTag = (tag: MergeTag) => {
    const chain = editor.chain().focus();
    if (!tag.linkText) {
      chain.insertContent(tag.tag).run();
      return;
    }
    if (!editor.state.selection.empty) {
      chain.setMark('link', { href: tag.tag, button: false }).run();
      return;
    }
    chain
      .insertContent({
        type: 'text',
        text: tag.linkText,
        marks: [{ type: 'link', attrs: { href: tag.tag } }],
      })
      .unsetMark('link')
      .run();
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: EMAIL.page,
      }}
    >
      <Toolbar
        editor={editor}
        onLink={() => openLinkDialog(false)}
        onButton={() => openLinkDialog(true)}
        onImage={openImageDialog}
        onMergeTag={insertMergeTag}
      />
      <Box sx={{ p: { xs: 1, sm: 3 } }}>
        <Box sx={surfaceSx}>
          <EditorContent editor={editor} />
        </Box>
      </Box>
      <LinkDialog
        open={linkOpen}
        draft={linkDraft}
        onClose={() => setLinkOpen(false)}
        onSave={saveLink}
        onRemove={removeLink}
      />
      <ImageDialog
        open={imageOpen}
        draft={imageDraft}
        onClose={() => setImageOpen(false)}
        onSave={saveImage}
      />
    </Box>
  );
};

// ---- toolbar ----

type BlockType = 'p' | 'h1' | 'h2' | 'h3';

const BLOCK_TYPES: { value: BlockType; label: string }[] = [
  { value: 'p', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
];

const Toolbar = ({
  editor,
  onLink,
  onButton,
  onImage,
  onMergeTag,
}: {
  editor: Editor;
  onLink: () => void;
  onButton: () => void;
  onImage: () => void;
  onMergeTag: (tag: MergeTag) => void;
}) => {
  // The editor does not re-render React on every transaction, so the active
  // states are read through a selector.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: (e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : 'p') as BlockType,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      link: e.isActive('link') && !e.isActive('link', { button: true }),
      button: e.isActive('link', { button: true }),
      image: e.isActive('image'),
      align: e.isActive({ textAlign: 'center' })
        ? 'center'
        : e.isActive({ textAlign: 'right' })
          ? 'right'
          : 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const setBlock = (block: BlockType) => {
    const chain = editor.chain().focus();
    if (block === 'p') chain.setParagraph().run();
    else chain.setHeading({ level: Number(block[1]) as 1 | 2 | 3 }).run();
  };

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.25,
        px: 1,
        py: 0.75,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        borderRadius: '10px 10px 0 0',
      }}
    >
      <TextField
        select
        size="small"
        value={state.block}
        onChange={e => setBlock(e.target.value as BlockType)}
        slotProps={{ htmlInput: { 'aria-label': 'Text style' } }}
        sx={{
          width: 128,
          mr: 0.5,
          '& .MuiSelect-select': { py: 0.5, fontSize: '0.8rem' },
        }}
      >
        {BLOCK_TYPES.map(b => (
          <MenuItem key={b.value} value={b.value} sx={{ fontSize: '0.85rem' }}>
            {b.label}
          </MenuItem>
        ))}
      </TextField>
      <ToolButton
        label="Bold"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={15} />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} />
      </ToolButton>
      <ToolButton
        label="Underline"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline size={15} />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={15} />
      </ToolButton>
      <ToolButton
        label="Inline code"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code size={15} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Bulleted list"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={15} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </ToolButton>
      <ToolButton
        label="Quote"
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={15} />
      </ToolButton>
      <ToolButton
        label="Divider"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={15} />
      </ToolButton>
      <Divider />
      <ToolButton
        label={state.link ? 'Edit link' : 'Link'}
        active={state.link}
        onClick={onLink}
      >
        <LinkIcon size={15} />
      </ToolButton>
      <ToolButton
        label={state.button ? 'Edit button' : 'Button'}
        active={state.button}
        onClick={onButton}
      >
        <RectangleHorizontal size={15} />
      </ToolButton>
      <ToolButton
        label="Remove link"
        disabled={!state.link && !state.button}
        onClick={() =>
          editor.chain().focus().extendMarkRange('link').unsetLink().run()
        }
      >
        <Unlink size={15} />
      </ToolButton>
      <ToolButton
        label={state.image ? 'Edit image' : 'Image'}
        active={state.image}
        onClick={onImage}
      >
        <ImageIcon size={15} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Align left"
        active={state.align === 'left'}
        // Left is the default, so it clears the style rather than writing it.
        onClick={() => editor.chain().focus().unsetTextAlign().run()}
      >
        <AlignLeft size={15} />
      </ToolButton>
      <ToolButton
        label="Align center"
        active={state.align === 'center'}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        <AlignCenter size={15} />
      </ToolButton>
      <ToolButton
        label="Align right"
        active={state.align === 'right'}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      >
        <AlignRight size={15} />
      </ToolButton>
      <Divider />
      <ToolButton
        label="Undo"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 size={15} />
      </ToolButton>
      <ToolButton
        label="Redo"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 size={15} />
      </ToolButton>
      <Divider />
      <MergeTagMenu onInsert={onMergeTag} />
    </Box>
  );
};

const ToolButton = ({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <Tooltip title={label} disableInteractive>
    {/* The span keeps the tooltip working while the button is disabled. */}
    <span>
      <IconButton
        size="small"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        // Keeps the editor's selection while the toolbar is clicked.
        onMouseDown={e => e.preventDefault()}
        onClick={onClick}
        sx={{
          borderRadius: 0.75,
          color: active ? 'primary.light' : 'text.secondary',
          bgcolor: active ? 'rgba(249,115,22,0.14)' : 'transparent',
          '&:hover': {
            color: 'text.primary',
            bgcolor: active ? 'rgba(249,115,22,0.2)' : 'rgba(255,255,255,0.06)',
          },
        }}
      >
        {children}
      </IconButton>
    </span>
  </Tooltip>
);

const Divider = () => (
  <Box sx={{ width: '1px', height: 20, bgcolor: 'divider', mx: 0.5 }} />
);

// ---- editing surface ----

const surfaceSx = {
  maxWidth: 600,
  mx: 'auto',
  bgcolor: EMAIL.card,
  borderRadius: '16px',
  '& .ProseMirror': {
    outline: 'none',
    minHeight: 360,
    p: { xs: '20px', sm: '24px 32px' },
    color: EMAIL.text,
    fontFamily: EMAIL_FONT,
    fontSize: '14px',
    lineHeight: 1.6,
    overflowWrap: 'anywhere',
    '& > :last-child': { mb: 0 },
    '& p': { m: '0 0 16px' },
    '& h1, & h2, & h3': {
      color: EMAIL.heading,
      fontWeight: 700,
      lineHeight: 1.3,
      m: '0 0 12px',
    },
    '& h1': { fontSize: '22px' },
    '& h2': { fontSize: '18px' },
    '& h3': { fontSize: '16px' },
    '& a': { color: EMAIL.accent, textDecoration: 'underline' },
    '& a[data-button="true"]': {
      display: 'inline-block',
      p: '14px 32px',
      bgcolor: EMAIL.accent,
      color: '#111111',
      fontSize: '15px',
      fontWeight: 700,
      textDecoration: 'none',
      borderRadius: '8px',
    },
    '& ul, & ol': { m: '0 0 16px', pl: '24px' },
    '& li': { mb: '6px' },
    '& li > p': { m: 0 },
    '& blockquote': {
      m: '0 0 16px',
      pl: '16px',
      borderLeft: `3px solid ${EMAIL.accent}`,
      color: EMAIL.muted,
    },
    '& blockquote > p:last-child': { mb: 0 },
    '& hr': { border: 0, borderTop: `1px solid ${EMAIL.rule}`, m: '24px 0' },
    '& img': {
      display: 'block',
      maxWidth: '100%',
      height: 'auto',
      m: '0 auto 16px',
      borderRadius: '8px',
    },
    '& img.ProseMirror-selectednode': {
      outline: '2px solid #f97316',
      outlineOffset: '2px',
    },
    '& code': {
      fontFamily: fontFamilyMono,
      fontSize: '13px',
      bgcolor: '#262626',
      p: '1px 4px',
      borderRadius: '4px',
    },
    '& p.is-editor-empty:first-of-type::before': {
      content: 'attr(data-placeholder)',
      float: 'left',
      height: 0,
      color: '#6b6b73',
      pointerEvents: 'none',
    },
  },
} as const;

export default RichTextEditor;
