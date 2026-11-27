import { useState } from 'react';
import { Box, Button, Menu, MenuItem, Typography } from '@mui/material';
import { Braces, ChevronDown } from 'lucide-react';
import { fontFamilyMono } from '../../fellowship/theme';
import { MERGE_TAGS, type MergeTag } from '../composer/composerUtils';

interface Props {
  onInsert: (tag: MergeTag) => void;
}

/** Personalisation placeholders the server fills in per recipient. */
const MergeTagMenu = ({ onInsert }: Props) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <Button
        size="small"
        onClick={e => setAnchor(e.currentTarget)}
        startIcon={<Braces size={14} />}
        endIcon={<ChevronDown size={14} />}
        aria-haspopup="menu"
        sx={{
          color: 'text.secondary',
          fontSize: '0.78rem',
          px: 1,
          minWidth: 0,
          '&:hover': { color: 'text.primary' },
        }}
      >
        Merge tag
      </Button>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 280 } } }}
      >
        {MERGE_TAGS.map(tag => (
          <MenuItem
            key={tag.tag}
            onClick={() => {
              setAnchor(null);
              onInsert(tag);
            }}
            sx={{ display: 'block', py: 1 }}
          >
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>
                {tag.label}
              </Typography>
              <Typography
                sx={{
                  fontFamily: fontFamilyMono,
                  fontSize: '0.75rem',
                  color: 'primary.light',
                }}
              >
                {tag.tag}
              </Typography>
            </Box>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
              {tag.description}
            </Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export default MergeTagMenu;
