// The single rule for a usable profile location, shared so the forms, the join
// gate and the API agree on exactly the same values (#45).
//
// Locations exist to find city leads for meetups and to invite people to
// meetups in their city. A location is picked rather than typed: a country
// first, then, for India (where most students are), a state and a city. The
// city can be typed when it isn't in the list. Outside India the city is
// optional.
//
// The parts are stored on the user (`country`, `state`, `city`), and
// `user.location` holds the composed display string ("Pune, Maharashtra,
// India") so search, emails and the admin views keep working on one column.

import { COUNTRIES } from './location-data/countries';

export { COUNTRIES };

/** ISO 3166-1 alpha-2 code for India. */
export const INDIA = 'IN';

export interface IndianState {
  /** ISO 3166-2:IN subdivision code, without the "IN-" prefix. */
  code: string;
  name: string;
}

/** The 28 states and 8 union territories, sorted by name. */
export const INDIAN_STATES: readonly IndianState[] = [
  { code: 'AN', name: 'Andaman and Nicobar Islands' },
  { code: 'AP', name: 'Andhra Pradesh' },
  { code: 'AR', name: 'Arunachal Pradesh' },
  { code: 'AS', name: 'Assam' },
  { code: 'BR', name: 'Bihar' },
  { code: 'CH', name: 'Chandigarh' },
  { code: 'CG', name: 'Chhattisgarh' },
  { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: 'DL', name: 'Delhi' },
  { code: 'GA', name: 'Goa' },
  { code: 'GJ', name: 'Gujarat' },
  { code: 'HR', name: 'Haryana' },
  { code: 'HP', name: 'Himachal Pradesh' },
  { code: 'JK', name: 'Jammu and Kashmir' },
  { code: 'JH', name: 'Jharkhand' },
  { code: 'KA', name: 'Karnataka' },
  { code: 'KL', name: 'Kerala' },
  { code: 'LA', name: 'Ladakh' },
  { code: 'LD', name: 'Lakshadweep' },
  { code: 'MP', name: 'Madhya Pradesh' },
  { code: 'MH', name: 'Maharashtra' },
  { code: 'MN', name: 'Manipur' },
  { code: 'ML', name: 'Meghalaya' },
  { code: 'MZ', name: 'Mizoram' },
  { code: 'NL', name: 'Nagaland' },
  { code: 'OD', name: 'Odisha' },
  { code: 'PY', name: 'Puducherry' },
  { code: 'PB', name: 'Punjab' },
  { code: 'RJ', name: 'Rajasthan' },
  { code: 'SK', name: 'Sikkim' },
  { code: 'TN', name: 'Tamil Nadu' },
  { code: 'TS', name: 'Telangana' },
  { code: 'TR', name: 'Tripura' },
  { code: 'UP', name: 'Uttar Pradesh' },
  { code: 'UK', name: 'Uttarakhand' },
  { code: 'WB', name: 'West Bengal' },
];

// Codes ISO 3166-2:IN used before its 2020/2023 updates. IP databases and old
// data still return them.
const LEGACY_STATE_CODES: Record<string, string> = {
  CT: 'CG',
  OR: 'OD',
  TG: 'TS',
  UT: 'UK',
  DN: 'DH',
  DD: 'DH',
};

// Other names people (and IP databases) use for a state, lowercased.
const STATE_NAME_ALIASES: Record<string, string> = {
  'andaman and nicobar': 'AN',
  'andaman & nicobar islands': 'AN',
  'andaman & nicobar': 'AN',
  orissa: 'OD',
  pondicherry: 'PY',
  uttaranchal: 'UK',
  'national capital territory of delhi': 'DL',
  'nct of delhi': 'DL',
  'new delhi': 'DL',
  'jammu & kashmir': 'JK',
  'dadra and nagar haveli': 'DH',
  'daman and diu': 'DH',
};

/**
 * Old or common names for Indian cities, lowercased, mapped to the state and
 * the name the city list uses. Lets the city search find "Bangalore" and the
 * location backfill read old free-text values.
 */
export const INDIA_CITY_ALIASES: Readonly<
  Record<string, { state: string; city: string }>
> = {
  bangalore: { state: 'KA', city: 'Bengaluru' },
  bombay: { state: 'MH', city: 'Mumbai' },
  madras: { state: 'TN', city: 'Chennai' },
  calcutta: { state: 'WB', city: 'Kolkata' },
  gurgaon: { state: 'HR', city: 'Gurugram' },
  poona: { state: 'MH', city: 'Pune' },
  baroda: { state: 'GJ', city: 'Vadodara' },
  trivandrum: { state: 'KL', city: 'Thiruvananthapuram' },
  cochin: { state: 'KL', city: 'Kochi' },
  ernakulam: { state: 'KL', city: 'Kochi' },
  calicut: { state: 'KL', city: 'Kozhikode' },
  trichy: { state: 'TN', city: 'Tiruchirappalli' },
  mysore: { state: 'KA', city: 'Mysuru' },
  mangalore: { state: 'KA', city: 'Mangaluru' },
  hubli: { state: 'KA', city: 'Hubballi' },
  belgaum: { state: 'KA', city: 'Belagavi' },
  gulbarga: { state: 'KA', city: 'Kalaburagi' },
  vizag: { state: 'AP', city: 'Visakhapatnam' },
  pondicherry: { state: 'PY', city: 'Puducherry' },
  allahabad: { state: 'UP', city: 'Prayagraj' },
  benares: { state: 'UP', city: 'Varanasi' },
  banaras: { state: 'UP', city: 'Varanasi' },
  bhubaneshwar: { state: 'OD', city: 'Bhubaneswar' },
  panaji: { state: 'GA', city: 'Panjim' },
  margao: { state: 'GA', city: 'Madgaon' },
  vasco: { state: 'GA', city: 'Vasco da Gama' },
};

const COUNTRY_NAMES = new Map<string, string>(COUNTRIES);

/** English name for an ISO alpha-2 code, or null when the code is unknown. */
export function countryName(code: string | null | undefined): string | null {
  return (code && COUNTRY_NAMES.get(code.toUpperCase())) || null;
}

/** An Indian state by ISO 3166-2:IN code (current or legacy, "IN-" optional). */
export function indianStateByCode(
  code: string | null | undefined
): IndianState | null {
  if (!code) return null;
  const bare = code.trim().toUpperCase().replace(/^IN-/, '');
  const current = LEGACY_STATE_CODES[bare] ?? bare;
  return INDIAN_STATES.find(s => s.code === current) ?? null;
}

/** An Indian state by name, ignoring case and accepting common old names. */
export function indianStateByName(
  name: string | null | undefined
): IndianState | null {
  const key = (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;
  const byName = INDIAN_STATES.find(s => s.name.toLowerCase() === key);
  if (byName) return byName;
  const aliasCode = STATE_NAME_ALIASES[key];
  return aliasCode ? indianStateByCode(aliasCode) : null;
}

export interface LocationParts {
  /** ISO 3166-1 alpha-2 code. */
  country: string | null;
  /** Indian state name as in INDIAN_STATES; null outside India. */
  state: string | null;
  /** City name. Required in India, optional elsewhere. */
  city: string | null;
}

/** Shape of GET /users/me/location-suggestion: every part may be unknown. */
export type LocationSuggestion = LocationParts;

/** Max length of a typed city, matching the column. */
export const CITY_MAX_LENGTH = 255;

export type LocationProblem =
  'noCountry' | 'unknownCountry' | 'noState' | 'unknownState' | 'noCity';

export const LOCATION_PROBLEM_MESSAGES: Record<LocationProblem, string> = {
  noCountry: 'Please choose your country.',
  unknownCountry: 'Please choose your country from the list.',
  noState: 'Please choose your state.',
  unknownState: 'Please choose your state from the list.',
  noCity: 'Please choose or type your city.',
};

const blank = (value: string | null | undefined) => !value || !value.trim();

/**
 * Why a location cannot be saved, or null when it is complete: a known
 * country, and for India a listed state and a non-blank city.
 */
export function locationProblem(
  parts: Partial<LocationParts> | null | undefined
): LocationProblem | null {
  const { country, state, city } = parts ?? {};
  if (blank(country)) return 'noCountry';
  if (!countryName(country)) return 'unknownCountry';
  if (country!.toUpperCase() !== INDIA) return null;
  if (blank(state)) return 'noState';
  if (indianStateByName(state)?.name !== state!.trim()) return 'unknownState';
  if (blank(city)) return 'noCity';
  return null;
}

/**
 * Trims the parts, upper-cases the country, and drops what doesn't apply: a
 * state outside India, and everything when there is no country. Blank parts
 * become null.
 */
export function normalizeLocationParts(
  parts: Partial<LocationParts> | null | undefined
): LocationParts {
  const clean = (v: string | null | undefined) => v?.trim() || null;
  const country = clean(parts?.country)?.toUpperCase() ?? null;
  if (!country) return { country: null, state: null, city: null };
  return {
    country,
    state: country === INDIA ? clean(parts?.state) : null,
    city: clean(parts?.city),
  };
}

/**
 * The display string stored in `user.location`: "Pune, Maharashtra, India",
 * "Nairobi, Kenya" or "Kenya". Null when there is no known country.
 */
export function composeLocation(
  parts: Partial<LocationParts> | null | undefined
): string | null {
  const { country, state, city } = normalizeLocationParts(parts);
  const name = countryName(country);
  if (!name) return null;
  return [city, state, name].filter(Boolean).join(', ');
}
