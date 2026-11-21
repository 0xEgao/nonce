import type { CityResponse } from 'maxmind';
import { toSuggestion } from '@/geoip/geoip.service';

const record = (r: {
    country?: string;
    subdivision?: { iso_code?: string; name?: string };
    city?: string;
}): CityResponse =>
    ({
        country: r.country ? { iso_code: r.country } : undefined,
        subdivisions: r.subdivision
            ? [
                  {
                      iso_code: r.subdivision.iso_code,
                      names: { en: r.subdivision.name },
                  },
              ]
            : undefined,
        city: r.city ? { names: { en: r.city } } : undefined,
    }) as unknown as CityResponse;

describe('toSuggestion', () => {
    it('maps an Indian record onto the pickers', () => {
        expect(
            toSuggestion(
                record({
                    country: 'IN',
                    subdivision: { iso_code: 'MH', name: 'Maharashtra' },
                    city: 'Pune',
                }),
            ),
        ).toEqual({ country: 'IN', state: 'Maharashtra', city: 'Pune' });
    });

    it('reads legacy state codes and old city names', () => {
        expect(
            toSuggestion(
                record({
                    country: 'IN',
                    subdivision: { iso_code: 'TG' },
                    city: 'Hyderabad',
                }),
            ),
        ).toEqual({ country: 'IN', state: 'Telangana', city: 'Hyderabad' });
        expect(
            toSuggestion(
                record({
                    country: 'IN',
                    subdivision: { iso_code: 'KA' },
                    city: 'Bangalore',
                }),
            ),
        ).toEqual({ country: 'IN', state: 'Karnataka', city: 'Bengaluru' });
    });

    it('falls back to the state name, and drops a city without a state', () => {
        expect(
            toSuggestion(
                record({
                    country: 'IN',
                    subdivision: {
                        name: 'National Capital Territory of Delhi',
                    },
                    city: 'New Delhi',
                }),
            ),
        ).toEqual({ country: 'IN', state: 'Delhi', city: 'New Delhi' });
        expect(toSuggestion(record({ country: 'IN', city: 'Pune' }))).toEqual({
            country: 'IN',
            state: null,
            city: null,
        });
    });

    it('keeps only country and city outside India', () => {
        expect(
            toSuggestion(
                record({
                    country: 'KE',
                    subdivision: { iso_code: '30', name: 'Nairobi County' },
                    city: 'Nairobi',
                }),
            ),
        ).toEqual({ country: 'KE', state: null, city: 'Nairobi' });
    });

    it('suggests nothing without a known country', () => {
        const none = { country: null, state: null, city: null };
        expect(toSuggestion(record({}))).toEqual(none);
        expect(toSuggestion(record({ country: 'EU' }))).toEqual(none);
    });
});
