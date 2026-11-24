import {
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fontFamilyMono } from '../../fellowship/theme';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

// Same footer as the users and reports admin tables.
const PaginationFooter = ({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: Props) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  const mono = {
    fontFamily: fontFamilyMono,
    fontSize: '0.74rem',
    color: 'text.secondary',
  };

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
          Rows
        </Typography>
        <TextField
          select
          size="small"
          value={pageSize}
          onChange={e => onPageSizeChange(Number(e.target.value))}
          slotProps={{ htmlInput: { 'aria-label': 'Rows per page' } }}
          sx={{
            '& .MuiSelect-select': { py: 0.25, pl: 1, fontSize: '0.74rem' },
          }}
        >
          {PAGE_SIZE_OPTIONS.map(n => (
            <MenuItem key={n} value={n} sx={{ fontSize: '0.8rem' }}>
              {n}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography sx={mono}>
          {from}–{to} of {total.toLocaleString()}
        </Typography>
        <IconButton
          size="small"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <Typography sx={mono}>
          {page + 1} / {pageCount}
        </Typography>
        <IconButton
          size="small"
          aria-label="Next page"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
          sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
        >
          <ChevronRight size={16} />
        </IconButton>
      </Stack>
    </Stack>
  );
};

export default PaginationFooter;
