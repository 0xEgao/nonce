import { SubscriberStatus, SubscriptionStatus } from '@/common/enum';
import {
    chunk,
    csvCell,
    decideImport,
    partitionEmails,
    partitionEntries,
    toCsv,
} from '@/newsletter/subscription.util';

describe('subscription utils', () => {
    describe('partitionEntries', () => {
        it('normalizes, dedupes, keeps the first name, drops blanks', () => {
            expect(
                partitionEntries([
                    { email: ' Alice@Example.com ' },
                    { email: 'alice@example.com', name: ' Alice ' },
                    { email: 'ALICE@example.com', name: 'Someone else' },
                    { email: 'nope' },
                    { email: 'nope' },
                    { email: '   ' },
                ]),
            ).toEqual({
                valid: [{ email: 'alice@example.com', name: 'Alice' }],
                invalid: ['nope'],
            });
        });

        it('caps names at the column length', () => {
            const { valid } = partitionEntries([
                { email: 'a@example.com', name: 'x'.repeat(300) },
            ]);
            expect(valid[0].name).toHaveLength(255);
        });

        it('returns malformed addresses as given', () => {
            expect(
                partitionEmails([' Not An Email ', 'b@example.com']),
            ).toEqual({
                valid: ['b@example.com'],
                invalid: [' Not An Email '],
            });
        });
    });

    describe('decideImport', () => {
        const active = { status: SubscriberStatus.ACTIVE };
        const bounced = { status: SubscriberStatus.BOUNCED };
        const row = (
            status: SubscriptionStatus,
            unsubscribedAt: Date | null = null,
        ) => ({ status, unsubscribedAt });
        const left = new Date('2026-01-01T00:00:00Z');

        it.each([
            [
                'new address',
                undefined,
                undefined,
                false,
                'added',
                'insert',
                false,
            ],
            [
                'active, no row',
                active,
                undefined,
                false,
                'added',
                'insert',
                false,
            ],
            [
                'active, SUBSCRIBED',
                active,
                row(SubscriptionStatus.SUBSCRIBED),
                false,
                'alreadySubscribed',
                null,
                false,
            ],
            [
                'active, PENDING',
                active,
                row(SubscriptionStatus.PENDING),
                false,
                'added',
                'promote',
                false,
            ],
            [
                'active, PENDING after leaving',
                active,
                row(SubscriptionStatus.PENDING, left),
                false,
                'skippedUnsubscribed',
                null,
                false,
            ],
            [
                'active, UNSUBSCRIBED',
                active,
                row(SubscriptionStatus.UNSUBSCRIBED, left),
                false,
                'skippedUnsubscribed',
                null,
                false,
            ],
            [
                'bounced, UNSUBSCRIBED row',
                bounced,
                row(SubscriptionStatus.UNSUBSCRIBED, left),
                false,
                'skippedSuppressed',
                null,
                false,
            ],
            [
                'bounced, SUBSCRIBED row',
                bounced,
                row(SubscriptionStatus.SUBSCRIBED),
                false,
                'skippedSuppressed',
                null,
                false,
            ],
            [
                'resubscribe: UNSUBSCRIBED',
                active,
                row(SubscriptionStatus.UNSUBSCRIBED, left),
                true,
                'added',
                'promote',
                false,
            ],
            [
                'resubscribe: bounced, no row',
                bounced,
                undefined,
                true,
                'added',
                'insert',
                true,
            ],
            [
                'resubscribe: bounced, SUBSCRIBED',
                bounced,
                row(SubscriptionStatus.SUBSCRIBED),
                true,
                'added',
                null,
                true,
            ],
            [
                'resubscribe: active, SUBSCRIBED',
                active,
                row(SubscriptionStatus.SUBSCRIBED),
                true,
                'alreadySubscribed',
                null,
                false,
            ],
        ] as const)(
            '%s',
            (
                _,
                subscriber,
                existingRow,
                resubscribe,
                outcome,
                rowAction,
                reactivate,
            ) => {
                expect(
                    decideImport(subscriber, existingRow, resubscribe),
                ).toEqual({ outcome, row: rowAction, reactivate });
            },
        );
    });

    describe('CSV', () => {
        it.each([
            ['plain', 'plain'],
            ['', ''],
            ['Smith, Bob', '"Smith, Bob"'],
            ['say "hi"', '"say ""hi"""'],
            ['two\nlines', '"two\nlines"'],
            ['=1+1', "'=1+1"],
            ['+1', "'+1"],
            ['-1', "'-1"],
            ['@SUM(A1)', "'@SUM(A1)"],
            ['\tTAB', "'\tTAB"],
            ['=HYPERLINK("x","y")', '"\'=HYPERLINK(""x"",""y"")"'],
            ['a=b', 'a=b'],
        ])('csvCell(%p)', (input, expected) => {
            expect(csvCell(input)).toBe(expected);
        });

        it('treats null as an empty cell', () => {
            expect(csvCell(null)).toBe('');
        });

        it('ends every row with CRLF', () => {
            expect(
                toCsv([
                    ['a', 'b'],
                    ['c', null],
                ]),
            ).toBe('a,b\r\nc,\r\n');
        });
    });

    it('chunk splits into pieces of at most the size', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunk([], 2)).toEqual([]);
    });
});
