import { fontFamilyMono } from '../../fellowship/theme';

/** The bordered box every newsletter admin table sits in. */
export const tableFrameSx = {
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 0.75,
  bgcolor: 'background.paper',
};

/** Header cells of the roomier, non-`small` tables. */
export const headCellSx = { py: 1.25, px: 2, letterSpacing: 0.8 };

/** Dates and counts in a table row. */
export const monoSx = {
  fontFamily: fontFamilyMono,
  fontSize: '0.78rem',
  color: 'text.secondary',
  whiteSpace: 'nowrap',
};
