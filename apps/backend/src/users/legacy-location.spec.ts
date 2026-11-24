import { parseLegacyLocation } from '@/users/legacy-location';

describe('parseLegacyLocation', () => {
    it.each([
        ['Pune, India', 'IN', 'Maharashtra', 'Pune'],
        ['pune', 'IN', 'Maharashtra', 'Pune'],
        ['Pune India', 'IN', 'Maharashtra', 'Pune'],
        ['Bangalore', 'IN', 'Karnataka', 'Bengaluru'],
        ['Bengaluru, Karnataka, IN', 'IN', 'Karnataka', 'Bengaluru'],
        ['Thāne, Maharashtra', 'IN', 'Maharashtra', 'Thane'],
        ['New Delhi', 'IN', 'Delhi', 'New Delhi'],
        ['Delhi', 'IN', 'Delhi', 'Delhi'],
        ['Kothrud, Maharashtra, India', 'IN', 'Maharashtra', 'Kothrud'],
        ['Gurgaon (Haryana)', 'IN', 'Haryana', 'Gurugram'],
        // Two Aurangabads (Maharashtra, Bihar): the state decides.
        ['Aurangabad, Bihar', 'IN', 'Bihar', 'Aurangabad'],
        ['Aurangabad', 'IN', null, null],
        ['India', 'IN', null, null],
        ['IN', 'IN', null, null],
        ['Maharashtra', 'IN', 'Maharashtra', null],
        ['Chennai, TN', 'IN', 'Tamil Nadu', 'Chennai'],
        ['Mumbai, MH, India', 'IN', 'Maharashtra', 'Mumbai'],
        ['Panaji, GA', 'IN', 'Goa', 'Panjim'],
        ['Nairobi, Kenya', 'KE', null, 'Nairobi'],
        ['Toronto, Canada', 'CA', null, 'Toronto'],
        ['Kenya', 'KE', null, null],
        ['San Francisco, CA, USA', 'US', null, 'San Francisco'],
        ['London - UK', 'GB', null, 'London'],
    ])('%p', (text, country, state, city) => {
        expect(parseLegacyLocation(text)).toEqual({ country, state, city });
    });

    it.each([[''], ['  '], [null], ['Kiambu'], ['Earth'], ['Remote']])(
        'leaves %p alone',
        (text) => {
            expect(parseLegacyLocation(text)).toBeNull();
        },
    );
});
