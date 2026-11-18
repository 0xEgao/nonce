import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateUserRequest } from '@/users/users.request';
import { CreateFellowshipApplicationRequestDto } from '@/fellowship-applications/fellowship-applications.request.dto';

const locationErrors = (cls: new () => object, location: unknown) =>
    validateSync(plainToInstance(cls, { location }))
        .filter((e) => e.property === 'location')
        .flatMap((e) => Object.values(e.constraints ?? {}));

describe('IsCityLocation on PATCH /users/me (UpdateUserRequest)', () => {
    it.each([['Pune, India'], [undefined], [null]])(
        'accepts %p',
        (location) => {
            expect(locationErrors(UpdateUserRequest, location)).toEqual([]);
        },
    );

    it.each([[''], ['   ']])('rejects blank %p', (location) => {
        expect(locationErrors(UpdateUserRequest, location)).toEqual([
            'Please enter your city.',
        ]);
    });

    it.each([['India'], ['india.'], ['IN']])(
        'rejects country-only %p with the city message',
        (location) => {
            expect(locationErrors(UpdateUserRequest, location)).toEqual([
                'Please enter your city, not just the country (e.g. "Pune, India").',
            ]);
        },
    );
});

describe('IsCityLocation on fellowship applications', () => {
    it('lets a draft save a blank location', () => {
        expect(
            locationErrors(CreateFellowshipApplicationRequestDto, ''),
        ).toEqual([]);
    });

    it('rejects a country-only location even on a draft', () => {
        expect(
            locationErrors(CreateFellowshipApplicationRequestDto, ' India '),
        ).toHaveLength(1);
    });
});
