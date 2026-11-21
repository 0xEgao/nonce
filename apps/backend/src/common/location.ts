import {
    composeLocation,
    LocationParts,
    normalizeLocationParts,
} from '@nonce/shared';

/**
 * The user columns a location write sets: the normalized parts plus the
 * display string composed from them, so `location` never drifts from the parts.
 */
export function locationColumns(
    parts: Partial<LocationParts>,
): LocationParts & { location: string | null } {
    const normalized = normalizeLocationParts(parts);
    return { ...normalized, location: composeLocation(normalized) };
}
