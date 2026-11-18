import { locationProblem } from '@nonce/shared';

// The shared package has no test runner of its own; the rule is pinned here.
describe('locationProblem', () => {
    it.each([
        ['Pune, India', null],
        ['Bengaluru', null],
        ['Kiambu, Kenya', null],
        ['Indore', null],
        ['India Gate, Delhi', null],
        ['', 'blank'],
        ['   ', 'blank'],
        [null, 'blank'],
        [undefined, 'blank'],
        ['India', 'countryOnly'],
        ['india', 'countryOnly'],
        ['  INDIA  ', 'countryOnly'],
        ['India.', 'countryOnly'],
        ['IN', 'countryOnly'],
        ['Ind', 'countryOnly'],
        ['Bharat', 'countryOnly'],
    ])('%p -> %p', (location, expected) => {
        expect(locationProblem(location)).toBe(expected);
    });
});
