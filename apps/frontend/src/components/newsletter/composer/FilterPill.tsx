import { Box } from '@mui/material';

// Same shape as the filter pills on the other admin tables.
const FilterPill = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <Box
    component="button"
    type="button"
    aria-pressed={active}
    onClick={onClick}
    sx={{
      px: 1.5,
      py: 0.5,
      borderRadius: 999,
      border: '1px solid',
      borderColor: active ? 'primary.main' : 'divider',
      bgcolor: active ? 'rgba(249,115,22,0.08)' : 'background.paper',
      color: active ? 'primary.light' : 'text.secondary',
      fontFamily: 'inherit',
      fontWeight: 600,
      fontSize: '0.8rem',
      cursor: 'pointer',
      transition: 'all 0.15s',
      '&:hover': active
        ? {}
        : { borderColor: 'primary.light', color: 'text.primary' },
    }}
  >
    {label}
  </Box>
);

export default FilterPill;
