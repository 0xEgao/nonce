import {
  CITY_MAX_LENGTH,
  INDIA,
  INDIA_CITY_ALIASES,
  LOCATION_PROBLEM_MESSAGES,
  countryName,
  indianStateByCode,
  indianStateByName,
  type LocationParts,
  type LocationProblem,
  type LocationSuggestion,
} from '@nonce/shared';

/** One of the three inputs rendered by LocationFields. */
export type LocationField = keyof LocationParts;

export type LocationFieldErrors = Partial<
  Record<LocationField, string | null | undefined>
>;

const PROBLEM_FIELD: Record<LocationProblem, LocationField> = {
  noCountry: 'country',
  unknownCountry: 'country',
  noState: 'state',
  unknownState: 'state',
  noCity: 'city',
};

/** The input a location problem belongs to, so its message shows there. */
export const locationProblemField = (problem: LocationProblem): LocationField =>
  PROBLEM_FIELD[problem];

/** Per-field error messages for LocationFields from a single problem. */
export const locationProblemErrors = (
  problem: LocationProblem | null | undefined
): LocationFieldErrors =>
  problem
    ? { [locationProblemField(problem)]: LOCATION_PROBLEM_MESSAGES[problem] }
    : {};

/** The canonical spelling of an Indian city when it's a known old name. */
export const canonicalIndianCity = (
  city: string,
  stateCode: string | null | undefined
): string => {
  const alias = INDIA_CITY_ALIASES[city.trim().toLowerCase()];
  return alias && (!stateCode || alias.state === stateCode) ? alias.city : city;
};

/**
 * Turns the IP suggestion into parts the fields can show, or null when there
 * is no usable country. An unknown state is dropped (and with it the city,
 * which would be meaningless without one); a known old city name is mapped to
 * the list's spelling.
 */
export const suggestionToLocationParts = (
  suggestion: LocationSuggestion | null | undefined
): LocationParts | null => {
  const country = suggestion?.country?.trim().toUpperCase();
  if (!country || !countryName(country)) return null;
  const rawCity = suggestion?.city?.trim().slice(0, CITY_MAX_LENGTH) || null;
  if (country !== INDIA) return { country, state: null, city: rawCity };

  const alias = rawCity ? INDIA_CITY_ALIASES[rawCity.toLowerCase()] : null;
  const state =
    indianStateByName(suggestion?.state) ??
    indianStateByCode(suggestion?.state) ??
    indianStateByCode(alias?.state);
  if (!state) return { country, state: null, city: null };
  return {
    country,
    state: state.name,
    city: rawCity ? canonicalIndianCity(rawCity, state.code) : null,
  };
};
