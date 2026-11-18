import { registerDecorator, ValidationOptions } from 'class-validator';
import { LOCATION_PROBLEM_MESSAGES, locationProblem } from '@nonce/shared';

/**
 * Rejects a location that does not name a city (#45), using the rule shared
 * with the frontend forms. null/undefined are left to @IsOptional.
 *
 * `allowBlank` keeps an empty string valid for callers that use it to mean
 * "not filled in yet", such as fellowship application drafts, where
 * completeness is checked at submit instead.
 */
export function IsCityLocation(
    options: { allowBlank?: boolean } = {},
    validationOptions?: ValidationOptions,
): PropertyDecorator {
    return function (object: object, propertyName: string) {
        registerDecorator({
            name: 'IsCityLocation',
            target: object.constructor,
            propertyName,
            constraints: [],
            options: validationOptions,
            validator: {
                validate: (value: unknown): boolean => {
                    if (typeof value !== 'string') return true;
                    const problem = locationProblem(value);
                    if (problem === 'blank') return !!options.allowBlank;
                    return problem === null;
                },
                defaultMessage: (args): string => {
                    const problem = locationProblem(
                        typeof args?.value === 'string' ? args.value : '',
                    );
                    return LOCATION_PROBLEM_MESSAGES[problem ?? 'blank'];
                },
            },
        });
    };
}
