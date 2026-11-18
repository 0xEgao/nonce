// The single rule for whether a profile location is usable, shared so the
// forms, the join gate and the API reject exactly the same values (#45).
//
// Locations exist to find city leads for meetups and to invite people to
// meetups in their city, so a value has to name a city. Most students are in
// India, and a bare "India" says nothing about which city they are in.

/** Values that name only the country, compared after normalizing. */
const COUNTRY_ONLY_LOCATIONS = new Set(['india', 'in', 'ind', 'bharat']);

export type LocationProblem = 'blank' | 'countryOnly';

export const LOCATION_PROBLEM_MESSAGES: Record<LocationProblem, string> = {
  blank: 'Please enter your city.',
  countryOnly:
    'Please enter your city, not just the country (e.g. "Pune, India").',
};

/**
 * Why a location cannot be saved, or null when it names a city.
 * "Pune, India" passes; "", "  ", "India", "india." and "IN" do not.
 */
export function locationProblem(
  location: string | null | undefined
): LocationProblem | null {
  const normalized = (location ?? '')
    .trim()
    .replace(/[\s.,;:!]+$/, '')
    .toLowerCase();
  if (!normalized) return 'blank';
  if (COUNTRY_ONLY_LOCATIONS.has(normalized)) return 'countryOnly';
  return null;
}
