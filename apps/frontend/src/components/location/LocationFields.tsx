import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Autocomplete,
  Box,
  TextField,
  Typography,
  createFilterOptions,
  type FilterOptionsState,
  type SxProps,
  type Theme,
} from '@mui/material';
import {
  CITY_MAX_LENGTH,
  COUNTRIES,
  INDIA,
  INDIAN_STATES,
  INDIA_CITY_ALIASES,
  indianStateByName,
  type IndianState,
  type LocationParts,
} from '@nonce/shared';
import type { LocationField, LocationFieldErrors } from './locationParts';

type CitiesByState = Readonly<Record<string, readonly string[]>>;

// The city lists are ~45 KB, so they're split into their own chunk and only
// fetched once someone picks India. The promise is shared by every mount; a
// failed load is forgotten so the next mount retries.
let citiesPromise: Promise<CitiesByState> | null = null;
const loadIndiaCities = (): Promise<CitiesByState> => {
  citiesPromise ??= import('@nonce/shared/india-cities').then(
    m => m.INDIA_CITIES_BY_STATE,
    error => {
      citiesPromise = null;
      throw error;
    }
  );
  return citiesPromise;
};

const AUTOFILL_NOTE =
  'We filled this in from your connection — change it if it’s wrong.';
const CITY_TYPE_NOTE = 'Not in the list? Just type it.';
const CITY_OPTION_LIMIT = 50;

const filterCities = createFilterOptions<string>({ limit: CITY_OPTION_LIMIT });

// Matches the list by substring, and also surfaces the current name when an
// old one is typed: "Bangalore" offers "Bengaluru" when Karnataka is picked.
const cityFilter =
  (stateCode: string | null) =>
  (options: string[], params: FilterOptionsState<string>): string[] => {
    const matches = filterCities(options, params);
    const typed = params.inputValue.trim().toLowerCase();
    if (typed.length < 3) return matches;
    const renamed = Object.entries(INDIA_CITY_ALIASES)
      .filter(
        ([old, alias]) => old.startsWith(typed) && alias.state === stateCode
      )
      .map(([, alias]) => alias.city)
      .filter(city => options.includes(city) && !matches.includes(city));
    return [...new Set(renamed), ...matches];
  };

export interface LocationFieldsProps {
  value: LocationParts;
  /** Changing the country clears state and city; changing the state clears city. */
  onChange: (next: LocationParts) => void;
  onBlur?: (field: LocationField) => void;
  /** Messages to show under each input; the caller decides when to show them. */
  errors?: LocationFieldErrors;
  disabled?: boolean;
  /** Shows a note that the values came from the request IP. */
  autofilled?: boolean;
  /** Any other note to show under the fields. */
  hint?: ReactNode;
  /** A field's label. `required` is false only for the city outside India. */
  renderLabel?: (label: string, required: boolean) => ReactNode;
  /**
   * Renders text under an input or under the group. When omitted, inputs use
   * the TextField's own helperText (with a reserved blank line) instead.
   */
  renderHelper?: (text: ReactNode, error: boolean) => ReactNode;
  /** Styles for each Autocomplete root, to match the surrounding inputs. */
  inputSx?: SxProps<Theme>;
  /** Styles for the dropdown paper. */
  paperSx?: SxProps<Theme>;
  /** Styles for the grid around the inputs. */
  sx?: SxProps<Theme>;
  /** Lets a form library focus the input that has an error. */
  inputRefs?: Partial<Record<LocationField, Ref<HTMLInputElement>>>;
}

const defaultRenderLabel = (label: string, required: boolean) => (
  <Typography
    variant="caption"
    sx={{
      display: 'block',
      mb: 0.75,
      fontWeight: 600,
      color: 'text.secondary',
    }}
  >
    {required ? label : `${label} (optional)`}
  </Typography>
);

/**
 * Country, then for India a state and a city. The country and state are picked
 * from lists; the city list (India only) also accepts a typed city. Outside
 * India the city is free text and optional.
 */
const LocationFields = ({
  value,
  onChange,
  onBlur,
  errors = {},
  disabled,
  autofilled,
  hint,
  renderLabel = defaultRenderLabel,
  renderHelper,
  inputSx,
  paperSx,
  sx,
  inputRefs = {},
}: LocationFieldsProps) => {
  const isIndia = value.country === INDIA;
  const state: IndianState | null = isIndia
    ? indianStateByName(value.state)
    : null;

  const [cities, setCities] = useState<CitiesByState | null>(null);
  useEffect(() => {
    if (!isIndia || cities) return;
    let cancelled = false;
    // On failure the city stays a plain typed field.
    loadIndiaCities()
      .then(loaded => {
        if (!cancelled) setCities(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isIndia, cities]);

  // City list state for Enter (see the city Autocomplete): whether the list
  // is open, and the option the user arrowed or hovered to, if any.
  const [cityListOpen, setCityListOpen] = useState(false);
  const userHighlightedCity = useRef<string | null>(null);

  const countryOption =
    COUNTRIES.find(([code]) => code === value.country) ?? null;
  const cityOptions = state && cities ? [...(cities[state.code] ?? [])] : [];
  const cityReady = isIndia ? !!state : !!value.country;
  const cityPlaceholder = !cityReady
    ? isIndia
      ? 'Choose a state first'
      : 'Choose a country first'
    : isIndia
      ? 'Choose or type your city'
      : 'Your city';

  const slotProps = paperSx ? { paper: { sx: paperSx } } : undefined;

  // A message under one input: its error, else its note, else (with the
  // TextField's helperText) a blank line so the row heights stay level.
  const helper = (field: LocationField, note?: string) => {
    const error = errors[field];
    const text = error || note;
    if (renderHelper) {
      return {
        below: text ? renderHelper(text, !!error) : null,
        helperText: undefined,
        error: !!error,
      };
    }
    return { below: null, helperText: text || ' ', error: !!error };
  };

  const country = helper('country');
  const stateHelp = helper('state');
  const city = helper('city', isIndia && state ? CITY_TYPE_NOTE : undefined);

  const notes = [autofilled ? AUTOFILL_NOTE : null, hint].filter(Boolean);
  const columns = isIndia ? 3 : 2;

  return (
    <Box>
      <Box
        sx={[
          {
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: `repeat(${columns}, 1fr)` },
            columnGap: 2,
            rowGap: renderHelper ? 2 : 0,
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        <Box>
          {renderLabel('Country', true)}
          <Autocomplete
            options={COUNTRIES}
            value={countryOption}
            onChange={(_, next) => {
              const code = next?.[0] ?? null;
              if (code === value.country) return;
              onChange({ country: code, state: null, city: null });
            }}
            onBlur={() => onBlur?.('country')}
            getOptionLabel={([, name]) => name}
            isOptionEqualToValue={(a, b) => a[0] === b[0]}
            autoHighlight
            autoSelect
            disabled={disabled}
            slotProps={slotProps}
            sx={inputSx}
            renderInput={params => (
              <TextField
                {...params}
                size="small"
                inputRef={inputRefs.country}
                placeholder="Choose your country"
                error={country.error}
                helperText={country.helperText}
                slotProps={{
                  htmlInput: { ...params.inputProps, 'aria-label': 'Country' },
                }}
              />
            )}
          />
          {country.below}
        </Box>

        {isIndia && (
          <Box>
            {renderLabel('State', true)}
            <Autocomplete
              options={INDIAN_STATES}
              value={state}
              onChange={(_, next) => {
                const name = next?.name ?? null;
                if (name === value.state) return;
                onChange({ country: value.country, state: name, city: null });
              }}
              onBlur={() => onBlur?.('state')}
              getOptionLabel={s => s.name}
              isOptionEqualToValue={(a, b) => a.code === b.code}
              autoHighlight
              autoSelect
              disabled={disabled}
              slotProps={slotProps}
              sx={inputSx}
              renderInput={params => (
                <TextField
                  {...params}
                  size="small"
                  inputRef={inputRefs.state}
                  placeholder="Choose your state"
                  error={stateHelp.error}
                  helperText={stateHelp.helperText}
                  slotProps={{
                    htmlInput: { ...params.inputProps, 'aria-label': 'State' },
                  }}
                />
              )}
            />
            {stateHelp.below}
          </Box>
        )}

        <Box>
          {renderLabel('City', isIndia)}
          {/* Free text everywhere; in India it also offers the state's list. */}
          <Autocomplete
            freeSolo
            // Enter takes the top suggestion ("Bang" -> Bengaluru). MUI's
            // freeSolo keeps the typed text on Enter unless the user arrowed
            // to an option, so pick the top match here. With no suggestion,
            // or on tabbing away, the typed text stays as it is.
            autoHighlight
            open={cityListOpen}
            onOpen={() => setCityListOpen(true)}
            onClose={() => {
              setCityListOpen(false);
              userHighlightedCity.current = null;
            }}
            onHighlightChange={(_, option) => {
              userHighlightedCity.current = option;
            }}
            onKeyDown={event => {
              if (event.key !== 'Enter' || !cityListOpen) return;
              // An option the user moved to: MUI selects it itself.
              if (userHighlightedCity.current) return;
              const typed = value.city ?? '';
              const top = isIndia
                ? cityFilter(state?.code ?? null)(cityOptions, {
                    inputValue: typed,
                    getOptionLabel: option => option,
                  })[0]
                : undefined;
              if (!top) return;
              (event as { defaultMuiPrevented?: boolean }).defaultMuiPrevented =
                true;
              event.preventDefault();
              setCityListOpen(false);
              if (top !== value.city) onChange({ ...value, city: top });
            }}
            options={cityOptions}
            filterOptions={
              isIndia ? cityFilter(state?.code ?? null) : options => options
            }
            value={value.city ?? null}
            inputValue={value.city ?? ''}
            onInputChange={(_, text, reason) => {
              // 'reset' echoes a picked option, which onChange handles.
              if (reason === 'reset') return;
              const next = text.slice(0, CITY_MAX_LENGTH);
              if (next === (value.city ?? '')) return;
              onChange({ ...value, city: next || null });
            }}
            onChange={(_, next) => {
              if (next === value.city) return;
              onChange({ ...value, city: next || null });
            }}
            onBlur={() => onBlur?.('city')}
            // Until there's a country (and in India a state) the city has
            // nothing to belong to.
            disabled={disabled || !cityReady}
            slotProps={slotProps}
            sx={inputSx}
            renderInput={params => (
              <TextField
                {...params}
                size="small"
                inputRef={inputRefs.city}
                placeholder={cityPlaceholder}
                error={city.error}
                helperText={city.helperText}
                slotProps={{
                  htmlInput: {
                    ...params.inputProps,
                    maxLength: CITY_MAX_LENGTH,
                    'aria-label': 'City',
                  },
                }}
              />
            )}
          />
          {city.below}
        </Box>
      </Box>

      {notes.map((note, i) =>
        renderHelper ? (
          <Box key={i}>{renderHelper(note, false)}</Box>
        ) : (
          <Typography
            key={i}
            variant="caption"
            sx={{ display: 'block', color: 'text.secondary', mb: 1 }}
          >
            {note}
          </Typography>
        )
      )}
    </Box>
  );
};

export default LocationFields;
