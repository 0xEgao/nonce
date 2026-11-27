import { useMemo } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Checkbox,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { MailingListResponse } from '@nonce/shared';
import { useMailingLists } from '../../../hooks/newsletterHooks';
import { fontFamilyMono } from '../../fellowship/theme';
import {
  apiErrorMessage,
  type ParsedEmailList,
  plural,
} from '../shared/newsletterUtils';

interface Props {
  listIds: string[];
  onListIdsChange: (ids: string[]) => void;
  adHocText: string;
  onAdHocTextChange: (text: string) => void;
  adHoc: ParsedEmailList;
}

const AudiencePicker = ({
  listIds,
  onListIdsChange,
  adHocText,
  onAdHocTextChange,
  adHoc,
}: Props) => {
  // Archived lists too: a draft may still point at one, and it has to show up
  // to be removed. Only the selected ones are offered.
  const listsQuery = useMailingLists({ includeArchived: true });
  const allLists = useMemo(() => listsQuery.data ?? [], [listsQuery.data]);
  const options = useMemo(
    () => allLists.filter(l => !l.archivedAt || listIds.includes(l.id)),
    [allLists, listIds]
  );
  const selected = useMemo(
    () =>
      listIds
        .map(id => allLists.find(l => l.id === id))
        .filter((l): l is MailingListResponse => !!l),
    [allLists, listIds]
  );
  const listReach = selected.reduce((sum, l) => sum + l.subscriberCount, 0);
  const upperBound = listReach + adHoc.valid.length;

  return (
    <Stack spacing={2}>
      {listsQuery.isError && (
        <Alert severity="error">
          Couldn't load mailing lists: {apiErrorMessage(listsQuery.error)}
        </Alert>
      )}
      <Autocomplete
        multiple
        disableCloseOnSelect
        options={options}
        value={selected}
        loading={listsQuery.isLoading}
        onChange={(_, next) => onListIdsChange(next.map(l => l.id))}
        getOptionLabel={l => l.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        noOptionsText="No mailing lists yet. Create one under Lists."
        renderOption={({ key, ...props }, list, { selected: isSelected }) => (
          <Box component="li" key={key} {...props}>
            <Checkbox size="small" checked={isSelected} sx={{ mr: 1, p: 0 }} />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.88rem' }}>
                {list.name}
                {list.archivedAt && (
                  <Box
                    component="span"
                    sx={{ color: 'text.secondary', fontSize: '0.75rem' }}
                  >
                    {' '}
                    (archived)
                  </Box>
                )}
              </Typography>
            </Box>
            <Typography
              sx={{
                fontFamily: fontFamilyMono,
                fontSize: '0.75rem',
                color: 'text.secondary',
                ml: 1,
              }}
            >
              {list.subscriberCount.toLocaleString()}
            </Typography>
          </Box>
        )}
        renderValue={(value, getItemProps) =>
          value.map((list, index) => {
            const { key, ...itemProps } = getItemProps({ index });
            return (
              <Chip
                key={key}
                size="small"
                label={`${list.name} · ${list.subscriberCount.toLocaleString()}`}
                {...itemProps}
              />
            );
          })
        }
        renderInput={params => (
          <TextField
            {...params}
            label="Mailing lists"
            placeholder={selected.length === 0 ? 'Pick lists…' : undefined}
            size="small"
          />
        )}
      />

      <Box>
        <TextField
          label="Specific email addresses"
          fullWidth
          multiline
          minRows={2}
          maxRows={8}
          value={adHocText}
          onChange={e => onAdHocTextChange(e.target.value)}
          placeholder="Paste addresses, separated by commas, spaces or new lines"
          size="small"
        />
        <Stack
          direction="row"
          spacing={1.5}
          flexWrap="wrap"
          sx={{ mt: 0.75, rowGap: 0.5 }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {plural(adHoc.valid.length, 'address', 'addresses')}
          </Typography>
          {adHoc.invalid.length > 0 && (
            <Typography variant="caption" sx={{ color: 'warning.main' }}>
              {adHoc.invalid.length} not valid, not saved:{' '}
              <Box component="span" sx={{ fontFamily: fontFamilyMono }}>
                {adHoc.invalid.join(', ')}
              </Box>
            </Typography>
          )}
        </Stack>
      </Box>

      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {upperBound === 0
          ? 'No recipients yet.'
          : `Up to ${plural(upperBound, 'recipient')}. Overlaps and unsubscribed addresses come off when you send.`}
      </Typography>
    </Stack>
  );
};

export default AudiencePicker;
