import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm';
import type { AddSubscriberEntry, AddSubscribersResponse } from '@nonce/shared';
import { SubscriberStatus, SubscriptionStatus } from '@/common/enum';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';
import { Subscriber } from '@/entities/subscriber.entity';
import { SUBSCRIBER_NAME_MAX_LENGTH } from '@/newsletter/newsletter.constants';
import { isValidEmail, normalizeEmail } from '@/newsletter/newsletter.utils';

export interface ImportEntry {
    /** Normalized. */
    email: string;
    name: string | null;
}

/**
 * Normalizes, validates and deduplicates addresses. The first non-blank name
 * given for an address wins. Blank addresses (an empty trailing CSV line) are
 * dropped; malformed ones come back as given.
 */
export function partitionEntries(entries: AddSubscriberEntry[]): {
    valid: ImportEntry[];
    invalid: string[];
} {
    const valid = new Map<string, ImportEntry>();
    const invalid = new Set<string>();
    for (const entry of entries) {
        const email = normalizeEmail(entry.email);
        if (!email) continue;
        if (!isValidEmail(email)) {
            invalid.add(entry.email);
            continue;
        }
        const name =
            entry.name?.trim().slice(0, SUBSCRIBER_NAME_MAX_LENGTH) || null;
        const existing = valid.get(email);
        if (!existing) valid.set(email, { email, name });
        else if (!existing.name && name) existing.name = name;
    }
    return { valid: [...valid.values()], invalid: [...invalid] };
}

export function partitionEmails(emails: string[]): {
    valid: string[];
    invalid: string[];
} {
    const { valid, invalid } = partitionEntries(
        emails.map((email) => ({ email })),
    );
    return { valid: valid.map((entry) => entry.email), invalid };
}

/**
 * Whether the address left this list itself. A PENDING row keeps its
 * `unsubscribedAt` until it is confirmed, so typing someone else's address
 * into the public form cannot reopen the list to an admin import.
 */
export function hasOptedOut(
    row: Pick<MailingListSubscription, 'status' | 'unsubscribedAt'>,
): boolean {
    return (
        row.status === SubscriptionStatus.UNSUBSCRIBED ||
        (row.status === SubscriptionStatus.PENDING &&
            row.unsubscribedAt !== null)
    );
}

export type ImportCounts = Omit<AddSubscribersResponse, 'invalid'>;

export interface ImportDecision {
    outcome: keyof ImportCounts;
    /** `insert` a SUBSCRIBED row, or `promote` the existing one to SUBSCRIBED. */
    row: 'insert' | 'promote' | null;
    /** Set the subscriber back to ACTIVE. */
    reactivate: boolean;
}

/**
 * What an admin adding an address to a list does to it. Every address lands
 * in exactly one count. Without `resubscribe`, a global suppression is
 * reported ahead of a list-level unsubscribe: it is the reason nothing would
 * reach them even if the row were restored.
 */
export function decideImport(
    subscriber: Pick<Subscriber, 'status'> | undefined,
    row: Pick<MailingListSubscription, 'status' | 'unsubscribedAt'> | undefined,
    resubscribe: boolean,
): ImportDecision {
    if (!subscriber) {
        return { outcome: 'added', row: 'insert', reactivate: false };
    }
    const suppressed = subscriber.status !== SubscriberStatus.ACTIVE;
    if (!resubscribe && suppressed) {
        return { outcome: 'skippedSuppressed', row: null, reactivate: false };
    }
    if (!resubscribe && row && hasOptedOut(row)) {
        return {
            outcome: 'skippedUnsubscribed',
            row: null,
            reactivate: false,
        };
    }
    if (row?.status === SubscriptionStatus.SUBSCRIBED && !suppressed) {
        return { outcome: 'alreadySubscribed', row: null, reactivate: false };
    }
    return {
        outcome: 'added',
        row: !row
            ? 'insert'
            : row.status === SubscriptionStatus.SUBSCRIBED
              ? null
              : 'promote',
        reactivate: suppressed,
    };
}

/**
 * One multi-row INSERT ... ON CONFLICT DO NOTHING. Returns how many rows were
 * actually inserted; the rest already existed (a unique constraint matched).
 */
export async function insertIgnoringConflicts<T extends ObjectLiteral>(
    manager: EntityManager,
    entity: EntityTarget<T>,
    values: QueryDeepPartialEntity<T>[],
): Promise<number> {
    if (values.length === 0) return 0;
    const result = await manager
        .createQueryBuilder()
        .insert()
        .into(entity)
        .values(values)
        .orIgnore()
        .updateEntity(false)
        .returning('id')
        .execute();
    return Array.isArray(result.raw) ? result.raw.length : values.length;
}

export function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

// Spreadsheet apps evaluate a cell starting with one of these as a formula,
// and subscriber names are whatever was typed into the public form.
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/** One RFC 4180 field, defused against formula injection. */
export function csvCell(value: string | null | undefined): string {
    let cell = value ?? '';
    if (FORMULA_TRIGGERS.some((trigger) => cell.startsWith(trigger))) {
        cell = `'${cell}`;
    }
    return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCsv(rows: (string | null)[][]): string {
    return rows.map((row) => row.map(csvCell).join(',') + '\r\n').join('');
}
