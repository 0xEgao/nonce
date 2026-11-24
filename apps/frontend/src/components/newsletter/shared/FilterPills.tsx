import { Box, Stack } from '@mui/material';

interface Props<T extends string> {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
}

/** Same pill as the filter chips on the other admin pages. */
const FilterPills = <T extends string>({
  options,
  value,
  onChange,
}: Props<T>) => (
  <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ rowGap: 1 }}>
    {options.map(option => {
      const active = option.value === value;
      return (
        <Box
          key={option.value}
          component="button"
          type="button"
          aria-pressed={active}
          onClick={() => onChange(option.value)}
          sx={{
            px: 1.25,
            py: 0.4,
            borderRadius: 999,
            border: '1px solid',
            borderColor: active ? 'primary.main' : 'divider',
            bgcolor: active ? 'rgba(249,115,22,0.08)' : 'background.paper',
            color: active ? 'primary.light' : 'text.secondary',
            fontFamily: 'inherit',
            fontWeight: 600,
            fontSize: '0.74rem',
            cursor: 'pointer',
            transition: 'all 0.15s',
            '&:hover': active
              ? {}
              : { borderColor: 'primary.light', color: 'text.primary' },
          }}
        >
          {option.label}
        </Box>
      );
    })}
  </Stack>
);

export default FilterPills;
