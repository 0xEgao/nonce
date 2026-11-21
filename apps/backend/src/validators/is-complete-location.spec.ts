import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateUserRequest } from '@/users/users.request';
import { CreateFellowshipApplicationRequestDto } from '@/fellowship-applications/fellowship-applications.request.dto';

const errors = (cls: new () => object, body: object) =>
    validateSync(plainToInstance(cls, body)).flatMap((e) =>
        Object.values(e.constraints ?? {}),
    );

describe('IsCompleteLocation on PATCH /users/me (UpdateUserRequest)', () => {
    it.each([
        [{}],
        [{ name: 'Alice' }],
        [{ country: 'IN', state: 'Maharashtra', city: 'Pune' }],
        [{ country: 'IN', state: 'Goa', city: 'A village not in the list' }],
        [{ country: 'KE', city: 'Kiambu' }],
        [{ country: 'KE' }],
    ])('accepts %j', (body) => {
        expect(errors(UpdateUserRequest, body)).toEqual([]);
    });

    it.each([
        [
            { country: null, state: null, city: null },
            'Please choose your country.',
        ],
        [{ city: 'Pune' }, 'Please choose your country.'],
        [{ country: 'XX' }, 'Please choose your country from the list.'],
        [{ country: 'IN' }, 'Please choose your state.'],
        [
            { country: 'IN', state: 'Bombay', city: 'Mumbai' },
            'Please choose your state from the list.',
        ],
        [
            { country: 'IN', state: 'Maharashtra', city: ' ' },
            'Please choose or type your city.',
        ],
    ])('rejects %j', (body, message) => {
        expect(errors(UpdateUserRequest, body)).toEqual([message]);
    });
});

// Drafts autosave a location prefilled from the profile, so an incomplete one
// must not block saving. Submit enforces the rule instead (see
// fellowship-applications.service.spec.ts).
describe('fellowship application drafts', () => {
    it.each([
        [{ locationCountry: '' }],
        [{ locationCountry: 'IN', locationState: '', locationCity: null }],
        [{ locationCountry: 'IN', locationState: 'Maharashtra' }],
    ])('accept %j', (body) => {
        expect(
            errors(CreateFellowshipApplicationRequestDto, {
                type: 'DEVELOPER',
                ...body,
            }),
        ).toEqual([]);
    });
});
