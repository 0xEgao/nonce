import {
    composeLocation,
    indianStateByCode,
    indianStateByName,
    locationProblem,
} from '@nonce/shared';
import { INDIA_CITIES_BY_STATE } from '@nonce/shared/india-cities';
import { INDIAN_STATES, INDIA_CITY_ALIASES } from '@nonce/shared';
import { locationColumns } from '@/common/location';

// The shared package has no test runner of its own; the rule is pinned here.
describe('locationProblem', () => {
    it.each([
        [{ country: 'IN', state: 'Maharashtra', city: 'Pune' }, null],
        [{ country: 'IN', state: 'Karnataka', city: 'Some Village' }, null],
        [{ country: 'KE', state: null, city: 'Kiambu' }, null],
        [{ country: 'KE', state: null, city: null }, null],
        [{ country: 'us', state: null, city: '' }, null],
        [null, 'noCountry'],
        [{}, 'noCountry'],
        [{ country: '  ', state: 'Maharashtra', city: 'Pune' }, 'noCountry'],
        [{ country: 'XX' }, 'unknownCountry'],
        [{ country: 'IN', state: null, city: 'Pune' }, 'noState'],
        [{ country: 'IN', state: 'Bombay', city: 'Pune' }, 'unknownState'],
        // Aliases are for reading old data, not for storing.
        [{ country: 'IN', state: 'Orissa', city: 'Cuttack' }, 'unknownState'],
        [{ country: 'IN', state: 'Maharashtra', city: ' ' }, 'noCity'],
        [{ country: 'IN', state: 'Maharashtra', city: null }, 'noCity'],
    ])('%j -> %s', (parts, expected) => {
        expect(locationProblem(parts)).toBe(expected);
    });
});

describe('composeLocation / locationColumns', () => {
    it('composes city, state and country for India', () => {
        expect(
            locationColumns({
                country: 'in',
                state: ' Maharashtra ',
                city: ' Pune ',
            }),
        ).toEqual({
            country: 'IN',
            state: 'Maharashtra',
            city: 'Pune',
            location: 'Pune, Maharashtra, India',
        });
    });

    it('drops a state outside India and allows no city', () => {
        expect(
            locationColumns({ country: 'KE', state: 'Nairobi', city: '' }),
        ).toEqual({
            country: 'KE',
            state: null,
            city: null,
            location: 'Kenya',
        });
    });

    it('clears everything without a country', () => {
        expect(
            locationColumns({ country: '', state: 'Goa', city: 'Panjim' }),
        ).toEqual({ country: null, state: null, city: null, location: null });
        expect(composeLocation({ country: 'XX', city: 'Atlantis' })).toBeNull();
    });
});

describe('Indian states', () => {
    it('finds states by current and legacy ISO codes', () => {
        expect(indianStateByCode('MH')?.name).toBe('Maharashtra');
        expect(indianStateByCode('IN-TG')?.name).toBe('Telangana');
        expect(indianStateByCode('OR')?.name).toBe('Odisha');
        expect(indianStateByCode('UT')?.name).toBe('Uttarakhand');
        expect(indianStateByCode('ZZ')).toBeNull();
    });

    it('finds states by name and old names', () => {
        expect(indianStateByName('tamil nadu')?.code).toBe('TN');
        expect(indianStateByName('Orissa')?.code).toBe('OD');
        expect(indianStateByName('NCT of Delhi')?.code).toBe('DL');
        expect(indianStateByName('Atlantis')).toBeNull();
    });

    it('has a city list for every state, and aliases point into it', () => {
        for (const state of INDIAN_STATES) {
            expect(INDIA_CITIES_BY_STATE[state.code]?.length).toBeGreaterThan(
                0,
            );
        }
        for (const alias of Object.values(INDIA_CITY_ALIASES)) {
            expect(INDIA_CITIES_BY_STATE[alias.state]).toContain(alias.city);
        }
    });
});
