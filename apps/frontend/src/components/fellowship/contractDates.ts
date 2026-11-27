import dayjs, { type Dayjs } from 'dayjs';

// Mirrors the backend's cap: a contract can't end more than 24 months from today.
export const MAX_CONTRACT_MONTHS = 24;

// Contract dates are stored as midnight UTC of the day the admin picked. Reading
// the day off the ISO string keeps it from shifting back a day west of UTC.
export const contractDay = (iso: string): Dayjs => dayjs(iso.slice(0, 10));
