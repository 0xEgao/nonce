import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { mkdir, mkdtemp, rename, rm, stat } from 'fs/promises';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { extract } from 'tar';
import { CityResponse, open, Reader } from 'maxmind';
import {
    countryName,
    INDIA,
    INDIA_CITY_ALIASES,
    indianStateByCode,
    indianStateByName,
    LocationSuggestion,
} from '@nonce/shared';

const DATABASE_FILE = 'GeoLite2-City.mmdb';
const DOWNLOAD_URL =
    'https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz';
// MaxMind publishes GeoLite2 twice a week; a week-old copy is fine for
// guessing someone's city, and keeps us far below the daily download limit.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const NO_SUGGESTION: LocationSuggestion = {
    country: null,
    state: null,
    city: null,
};

/**
 * Guesses a user's country, Indian state and city from their IP address, to
 * prefill the location pickers (#45). Uses MaxMind's free GeoLite2 City
 * database, downloaded with the account's license key and kept on disk.
 *
 * Optional: without the `geoip` config block every lookup returns no
 * suggestion and the forms simply start empty.
 */
@Injectable()
export class GeoIpService implements OnApplicationBootstrap {
    private readonly logger = new Logger(GeoIpService.name);
    private reader: Reader<CityResponse> | null = null;
    private refreshing: Promise<void> | null = null;

    constructor(private readonly configService: ConfigService) {}

    onApplicationBootstrap(): void {
        // Don't hold up boot on a ~60 MB download; lookups return nothing
        // until the database is open.
        void this.refresh(false);
    }

    // Wednesdays 05:00 UTC, after MaxMind's Tuesday release.
    @Cron('0 5 * * 3', { timeZone: 'UTC' })
    async weeklyRefresh(): Promise<void> {
        await this.refresh(true);
    }

    /** The best guess for `ip`; parts are null when unknown. */
    lookup(ip: string | undefined | null): LocationSuggestion {
        if (!this.reader || !ip) return NO_SUGGESTION;
        let record: CityResponse | null;
        try {
            record = this.reader.get(ip);
        } catch {
            return NO_SUGGESTION; // not an IP address
        }
        return record ? toSuggestion(record) : NO_SUGGESTION;
    }

    private config(): {
        accountId: string;
        licenseKey: string;
        databaseDir: string;
    } | null {
        const accountId = this.configService.get<string>('geoip.accountId');
        const licenseKey = this.configService.get<string>('geoip.licenseKey');
        const databaseDir =
            this.configService.get<string>('geoip.databaseDir') ||
            join(process.cwd(), 'data', 'geoip');
        if (!accountId || !licenseKey) return null;
        return { accountId: String(accountId), licenseKey, databaseDir };
    }

    /** Opens the database, downloading it first when missing, stale or forced. */
    refresh(force: boolean): Promise<void> {
        this.refreshing ??= this.doRefresh(force)
            .catch((error: unknown) =>
                this.logger.error(
                    `GeoLite2 refresh failed; ${this.reader ? 'keeping the current database' : 'IP location suggestions are off'}`,
                    error instanceof Error ? error.stack : String(error),
                ),
            )
            .finally(() => {
                this.refreshing = null;
            });
        return this.refreshing;
    }

    private async doRefresh(force: boolean): Promise<void> {
        const config = this.config();
        if (!config) {
            this.logger.log(
                'No GeoIP license configured; IP location suggestions are off',
            );
            return;
        }
        const path = join(config.databaseDir, DATABASE_FILE);
        const age = await fileAgeMs(path);
        if (force || age === null || age > MAX_AGE_MS) {
            await this.download(config, path);
        }
        this.reader = await open<CityResponse>(path);
        this.logger.log(`GeoLite2 City database loaded from ${path}`);
    }

    private async download(
        config: { accountId: string; licenseKey: string; databaseDir: string },
        path: string,
    ): Promise<void> {
        await mkdir(config.databaseDir, { recursive: true });
        // Extract next to the target, then rename, so a reader never sees a
        // half-written file and a failed download leaves the old one in place.
        const tmp = await mkdtemp(join(config.databaseDir, '.download-'));
        try {
            const response = await axios.get<Readable>(DOWNLOAD_URL, {
                auth: {
                    username: config.accountId,
                    password: config.licenseKey,
                },
                responseType: 'stream',
                timeout: 5 * 60 * 1000,
            });
            // The archive holds GeoLite2-City_<date>/GeoLite2-City.mmdb plus
            // licence files; keep only the database.
            await pipeline(
                response.data,
                extract({
                    cwd: tmp,
                    strip: 1,
                    filter: (entry) => entry.endsWith(`/${DATABASE_FILE}`),
                }),
            );
            await rename(join(tmp, DATABASE_FILE), path);
            this.logger.log('Downloaded the GeoLite2 City database');
        } finally {
            await rm(tmp, { recursive: true, force: true });
        }
    }
}

async function fileAgeMs(path: string): Promise<number | null> {
    try {
        return Date.now() - (await stat(path)).mtimeMs;
    } catch {
        return null;
    }
}

/** Maps a GeoLite2 record onto the location pickers' values. */
export function toSuggestion(record: CityResponse): LocationSuggestion {
    const country = record.country?.iso_code?.toUpperCase() ?? null;
    if (!country || !countryName(country)) return NO_SUGGESTION;
    const city = record.city?.names?.en?.trim() || null;
    if (country !== INDIA) return { country, state: null, city };

    const subdivision = record.subdivisions?.[0];
    const state =
        indianStateByCode(subdivision?.iso_code) ??
        indianStateByName(subdivision?.names?.en);
    // Use the city list's name for a city MaxMind spells the old way
    // ("Bangalore"), as long as it's in the same state.
    const alias = city ? INDIA_CITY_ALIASES[city.toLowerCase()] : undefined;
    const canonicalCity =
        alias && (!state || alias.state === state.code) ? alias.city : city;
    return {
        country,
        state: state?.name ?? null,
        // A city without its state can't be shown in the India pickers.
        city: state ? canonicalCity : null,
    };
}
