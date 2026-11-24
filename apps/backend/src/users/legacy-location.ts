// Reads an old free-text profile location ("Pune, India", "Bangalore",
// "Nairobi, Kenya") into country/state/city for the one-off backfill that
// came with the location pickers (#45). Best effort: a part is only filled in
// when the text says it unambiguously, and the user re-picks the rest.
//
// Used by a migration, so it imports nothing but @nonce/shared (no `@/` paths).

import {
    COUNTRIES,
    INDIA,
    INDIA_CITY_ALIASES,
    INDIAN_STATES,
    indianStateByCode,
    indianStateByName,
    LocationParts,
} from '@nonce/shared';
import { INDIA_CITIES_BY_STATE } from '@nonce/shared/india-cities';

/** Lowercase, no accents or punctuation at the ends, single spaces. */
const key = (s: string): string =>
    s
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();

const COUNTRY_ALIASES: Record<string, string> = {
    bharat: INDIA,
    ind: INDIA,
    usa: 'US',
    'united states of america': 'US',
    america: 'US',
    uk: 'GB',
    'great britain': 'GB',
    england: 'GB',
    scotland: 'GB',
    wales: 'GB',
    uae: 'AE',
    holland: 'NL',
    russia: 'RU',
    'south korea': 'KR',
    korea: 'KR',
    turkey: 'TR',
    vietnam: 'VN',
};

const COUNTRY_BY_KEY = new Map<string, string>();
for (const [code, name] of COUNTRIES) COUNTRY_BY_KEY.set(key(name), code);
// Only a few two-letter codes: most collide with Indian state abbreviations
// ("Chennai, TN" is Tamil Nadu, not Tunisia; MH, GA, ML, BR, CH, ...).
for (const code of ['in', 'us', 'gb']) {
    COUNTRY_BY_KEY.set(code, code.toUpperCase());
}
for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    COUNTRY_BY_KEY.set(alias, code);
}

/** City key -> the states that have a city by that name, and its spelling. */
const CITY_INDEX = new Map<string, { state: string; city: string }[]>();
for (const [state, cities] of Object.entries(INDIA_CITIES_BY_STATE)) {
    for (const city of cities) {
        const k = key(city);
        CITY_INDEX.set(k, [...(CITY_INDEX.get(k) ?? []), { state, city }]);
    }
}
for (const [alias, target] of Object.entries(INDIA_CITY_ALIASES)) {
    if (!CITY_INDEX.has(alias)) CITY_INDEX.set(alias, [target]);
}

const stateName = (code: string): string | null =>
    INDIAN_STATES.find((s) => s.code === code)?.name ?? null;

/**
 * The parts the text names unambiguously, or null when it names nothing we
 * recognise (left for the user to pick).
 */
export function parseLegacyLocation(
    text: string | null | undefined,
): LocationParts | null {
    let parts = (text ?? '')
        .split(/[,;/|()]+|\s+-\s+/)
        .map((p) => p.trim())
        .filter((p) => key(p));
    if (parts.length === 0) return null;

    // Country: the last part that names one ("Pune, India").
    let country: string | null = null;
    let countryIndex = -1;
    parts.forEach((p, i) => {
        const code = COUNTRY_BY_KEY.get(key(p));
        if (code) [country, countryIndex] = [code, i];
    });
    if (countryIndex !== -1) {
        parts = parts.filter((_, i) => i !== countryIndex);
    } else if (parts.length === 1) {
        // "Pune India": the last word of a single part.
        const words = parts[0].split(/\s+/);
        const last = words.length > 1 ? words[words.length - 1] : '';
        const code = COUNTRY_BY_KEY.get(key(last));
        if (code) {
            country = code;
            parts = [words.slice(0, -1).join(' ')];
        }
    }

    if (country && country !== INDIA) {
        return { country, state: null, city: parts[0] ?? null };
    }

    // India, or no country named: look for a state and a listed city.
    let state = null as string | null; // state code
    const leftovers: string[] = [];
    let cityMatches: { state: string; city: string }[] = [];
    for (const part of parts) {
        const k = key(part);
        // A state by name, or by its abbreviation next to other parts
        // ("Chennai, TN").
        const asState =
            indianStateByName(part) ??
            (parts.length > 1 && /^[a-z]{2}$/i.test(part.trim())
                ? indianStateByCode(part)
                : null);
        const asCity = CITY_INDEX.get(k) ?? [];
        if (asState && !state) {
            state = asState.code;
            // "Delhi" or "Chandigarh" alone name both the state and the city.
            if (
                asCity.some((c) => c.state === asState.code) &&
                parts.length === 1
            ) {
                cityMatches = asCity;
            }
        } else if (asCity.length > 0 && cityMatches.length === 0) {
            cityMatches = asCity;
        } else {
            leftovers.push(part);
        }
    }

    let city: string | null = null;
    const inState = state
        ? cityMatches.filter((c) => c.state === state)
        : cityMatches;
    if (inState.length === 1) {
        state ??= inState[0].state;
        city = inState[0].city;
    } else if (state && cityMatches.length === 0 && leftovers.length === 1) {
        // A town that isn't in the list, in a named state: keep it as typed.
        city = leftovers[0];
    }

    if (!country && !state && cityMatches.length === 0) return null;
    return {
        country: INDIA,
        state: state ? stateName(state) : null,
        city: state ? city : null,
    };
}
