import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
} from 'class-validator';
import {
    LOCATION_PROBLEM_MESSAGES,
    LocationParts,
    locationProblem,
} from '@nonce/shared';

/** True when the request sends any of the three location parts. */
export const sendsLocation = (o: Partial<LocationParts>): boolean =>
    o.country !== undefined || o.state !== undefined || o.city !== undefined;

// Non-string parts are left to the other validators on state and city; a
// non-string country can't name a known country, so it reads as unknown.
const partsOf = (args: ValidationArguments): Partial<LocationParts> => {
    const o = args.object as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
        country:
            o.country == null || typeof o.country === 'string'
                ? (o.country as string | null | undefined)
                : '??',
        state: str(o.state),
        city: str(o.city),
    };
};

/**
 * Put on `country` of a DTO that also has `state` and `city`, behind
 * `@ValidateIf(sendsLocation)`. Once any part is sent, the three are judged together by the rule shared with the forms
 * (#45): a known country, and in India a listed state and a city. A request
 * that sends none of them leaves the location alone and passes.
 */
export function IsCompleteLocation(
    validationOptions?: ValidationOptions,
): PropertyDecorator {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'IsCompleteLocation',
            target: object.constructor,
            propertyName,
            constraints: [],
            options: validationOptions,
            validator: {
                validate: (_value: unknown, args: ValidationArguments) =>
                    !sendsLocation(partsOf(args)) ||
                    locationProblem(partsOf(args)) === null,
                defaultMessage: (args?: ValidationArguments): string => {
                    const problem = args
                        ? locationProblem(partsOf(args))
                        : null;
                    return LOCATION_PROBLEM_MESSAGES[problem ?? 'noCountry'];
                },
            },
        });
    };
}
