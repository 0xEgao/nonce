import { useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Box, CircularProgress, Typography } from '@mui/material';
// Side-effect import: points Monaco at our bundle rather than a CDN.
import '../../assignment/monacoSetup.ts';
import { fontFamilyMono } from '../../fellowship/theme';
import MergeTagMenu from './MergeTagMenu';
import type { MergeTag } from './newsletterUtils';

type CodeEditor = Parameters<OnMount>[0];

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Raw-HTML mode: a full email document, sent exactly as written. Loaded lazily
 * so Monaco only ships to admins who open this mode.
 */
const HtmlEditor = ({ value, onChange }: Props) => {
  const editorRef = useRef<CodeEditor | null>(null);

  const insertMergeTag = (tag: MergeTag) => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    if (!editor || !selection) return;
    editor.executeEdits('merge-tag', [
      { range: selection, text: tag.tag, forceMoveMarkers: true },
    ]);
    editor.focus();
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: '#141417',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 1.5,
          py: 0.75,
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography
          sx={{
            fontFamily: fontFamilyMono,
            fontSize: '0.72rem',
            color: 'text.secondary',
          }}
        >
          index.html
        </Typography>
        <MergeTagMenu onInsert={insertMergeTag} />
      </Box>
      <Editor
        height={560}
        language="html"
        theme="vs-dark"
        value={value}
        onChange={next => onChange(next ?? '')}
        onMount={editor => {
          editorRef.current = editor;
        }}
        loading={<CircularProgress size={20} />}
        options={{
          fontFamily: fontFamilyMono,
          fontSize: 13,
          lineHeight: 20,
          padding: { top: 8 },
          wordWrap: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          renderLineHighlight: 'line',
          overviewRulerLanes: 0,
        }}
      />
    </Box>
  );
};

export default HtmlEditor;
