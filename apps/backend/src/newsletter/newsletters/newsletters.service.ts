import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import type {
    CreateNewsletterRequest,
    ListNewsletterDeliveriesQuery,
    ListNewslettersQuery,
    NewsletterAudienceResponse,
    NewsletterDeliveryResponse,
    NewsletterDetailResponse,
    NewsletterPreviewResponse,
    NewsletterSettingsResponse,
    NewsletterStats,
    NewsletterSummaryResponse,
    PaginatedData,
    PreviewNewsletterRequest,
    SendNewsletterRequest,
    SendTestRequest,
    SendTestResponse,
    UpdateNewsletterRequest,
} from '@nonce/shared';
import { MailingList } from '@/entities/mailing-list.entity';
import { Newsletter } from '@/entities/newsletter.entity';
import { NewsletterDelivery } from '@/entities/newsletter-delivery.entity';
import { User } from '@/entities/user.entity';
import { DbTransactionService } from '@/db-transaction/db-transaction.service';
import { PaginatedDataDto } from '@/common/dto';
import { escapeLikePattern } from '@/common/common';
import {
    NewsletterContentFormat,
    NewsletterDeliveryStatus,
    NewsletterStatus,
} from '@/common/enum';
import {
    NEWSLETTER_DEFAULT_SUBJECT,
    NEWSLETTER_MAX_IMPORT_SUBSCRIBERS,
    NEWSLETTER_SUBJECT_MAX_LENGTH,
} from '@/newsletter/newsletter.constants';
import { NewsletterMailerService } from '@/newsletter/sending/newsletter-mailer.service';
import {
    findUnknownMergeTags,
    NEWSLETTER_MERGE_TAGS,
    NewsletterRenderService,
    RenderableNewsletter,
    sampleRecipient,
} from '@/newsletter/rendering/newsletter-render.service';
import { NewsletterSendService } from '@/newsletter/sending/newsletter-send.service';
import { DELIVERY_STILL_WANTED_SQL } from '@/newsletter/sending/newsletter-send.store';
import { readNewsletterSettings } from '@/newsletter/newsletter-settings';
import { describeSmtpError } from '@/newsletter/sending/newsletter-smtp-errors';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';
import { SubscriptionService } from '@/newsletter/subscribers/subscription.service';
import { isValidEmail, normalizeEmail } from '@/newsletter/newsletter.utils';

const EMPTY_STATS: NewsletterStats = {
    total: 0,
    pending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    opened: 0,
    clicked: 0,
};

type NewsletterFields = Partial<
    Pick<
        Newsletter,
        | 'subject'
        | 'preheader'
        | 'contentFormat'
        | 'content'
        | 'replyTo'
        | 'adHocEmails'
        | 'trackingEnabled'
        | 'lists'
    >
>;

@Injectable()
export class NewslettersService {
    private readonly dailyLimit: number;
    private readonly ratePerMinute: number;

    constructor(
        @InjectRepository(Newsletter)
        private readonly newsletterRepository: Repository<Newsletter>,
        @InjectRepository(NewsletterDelivery)
        private readonly deliveryRepository: Repository<NewsletterDelivery>,
        @InjectRepository(MailingList)
        private readonly mailingListRepository: Repository<MailingList>,
        private readonly dbTransactionService: DbTransactionService,
        private readonly subscriptionService: SubscriptionService,
        private readonly renderService: NewsletterRenderService,
        private readonly sendService: NewsletterSendService,
        private readonly mailer: NewsletterMailerService,
        private readonly urlService: NewsletterUrlService,
        configService: ConfigService,
    ) {
        const settings = readNewsletterSettings(configService);
        this.dailyLimit = settings.dailyLimit;
        this.ratePerMinute = settings.ratePerMinute;
    }

    async list(
        query: ListNewslettersQuery,
    ): Promise<PaginatedData<NewsletterSummaryResponse>> {
        const page = query.page ?? 0;
        const pageSize = query.pageSize ?? 10;
        const qb = this.newsletterRepository
            .createQueryBuilder('newsletter')
            .leftJoinAndSelect('newsletter.lists', 'list')
            .leftJoinAndSelect('newsletter.createdBy', 'createdBy');

        if (query.status) {
            qb.andWhere('newsletter.status = :status', {
                status: query.status,
            });
        }
        if (query.search) {
            qb.andWhere('newsletter.subject ILIKE :search', {
                search: `%${escapeLikePattern(query.search)}%`,
            });
        }

        const [newsletters, totalRecords] = await qb
            .orderBy('newsletter.createdAt', 'DESC')
            .addOrderBy('newsletter.id', 'ASC')
            .skip(page * pageSize)
            .take(pageSize)
            .getManyAndCount();

        const stats = await this.loadStats(newsletters.map((n) => n.id));
        return new PaginatedDataDto({
            totalRecords,
            records: newsletters.map((newsletter) =>
                toSummary(newsletter, stats.get(newsletter.id)),
            ),
        });
    }

    async create(
        request: CreateNewsletterRequest,
        user: User,
    ): Promise<NewsletterDetailResponse> {
        const fields = await this.validatedFields(request);
        const newsletter = this.newsletterRepository.create({
            subject: NEWSLETTER_DEFAULT_SUBJECT,
            preheader: null,
            contentFormat: NewsletterContentFormat.RICH_TEXT,
            content: '',
            replyTo: null,
            adHocEmails: [],
            trackingEnabled: false,
            lists: [],
            ...fields,
            status: NewsletterStatus.DRAFT,
            createdBy: user,
        });
        const saved = await this.newsletterRepository.save(newsletter);
        return this.get(saved.id);
    }

    async get(id: string): Promise<NewsletterDetailResponse> {
        const newsletter = await this.findOrFail(id);
        const stats = await this.loadStats([id]);
        return toDetail(newsletter, stats.get(id));
    }

    /** DRAFT only. */
    async update(
        id: string,
        request: UpdateNewsletterRequest,
    ): Promise<NewsletterDetailResponse> {
        const fields = await this.validatedFields(request);
        await this.dbTransactionService.execute(async (manager) => {
            // Locked so a concurrent send cannot start from a half-applied edit.
            const newsletter = await manager.findOne(Newsletter, {
                where: { id },
                lock: { mode: 'pessimistic_write' },
            });
            if (!newsletter)
                throw new NotFoundException('Newsletter not found');
            assertDraft(newsletter, 'edited');
            Object.assign(newsletter, fields);
            await manager.save(Newsletter, newsletter);
        });
        return this.get(id);
    }

    /** DRAFT only. */
    async remove(id: string): Promise<void> {
        const result = await this.newsletterRepository.delete({
            id,
            status: NewsletterStatus.DRAFT,
        });
        if (!result.affected) {
            assertDraft(await this.findOrFail(id), 'deleted');
        }
    }

    async duplicate(id: string, user: User): Promise<NewsletterDetailResponse> {
        const source = await this.findOrFail(id);
        const copy = this.newsletterRepository.create({
            subject: `Copy of ${source.subject}`.slice(
                0,
                NEWSLETTER_SUBJECT_MAX_LENGTH,
            ),
            preheader: source.preheader,
            contentFormat: source.contentFormat,
            content: source.content,
            replyTo: source.replyTo,
            // An archived list cannot be sent to, so the copy leaves it out.
            lists: source.lists.filter((list) => !list.archivedAt),
            adHocEmails: [...source.adHocEmails],
            trackingEnabled: source.trackingEnabled,
            status: NewsletterStatus.DRAFT,
            createdBy: user,
        });
        const saved = await this.newsletterRepository.save(copy);
        return this.get(saved.id);
    }

    async preview(
        id: string,
        request: PreviewNewsletterRequest,
    ): Promise<NewsletterPreviewResponse> {
        const newsletter = await this.findOrFail(id);
        const renderable: RenderableNewsletter = {
            ...newsletter,
            subject: request.subject ?? newsletter.subject,
            preheader:
                request.preheader !== undefined
                    ? request.preheader
                    : newsletter.preheader,
            contentFormat: request.contentFormat ?? newsletter.contentFormat,
            content: request.content ?? newsletter.content,
        };
        const { subject, html, text } = this.renderService.render(
            renderable,
            sampleRecipient(),
            { mode: 'preview' },
        );
        return { subject, html, text };
    }

    async getAudience(id: string): Promise<NewsletterAudienceResponse> {
        const newsletter = await this.findOrFail(id);
        const [audience, sentLast24h] = await Promise.all([
            this.subscriptionService.resolveAudience(
                newsletter.lists.map((list) => list.id),
                newsletter.adHocEmails,
                { dryRun: true },
            ),
            this.sendService.countSentLast24h(),
        ]);
        const willSend = audience.recipients.length;
        return {
            total: willSend + audience.skipped.length,
            willSend,
            skipped: audience.skipped.length,
            invalidAdHoc: audience.invalid,
            dailyLimit: this.dailyLimit,
            sentLast24h,
            estimatedDays: this.estimateDays(willSend, sentLast24h),
        };
    }

    async sendTest(
        id: string,
        request: SendTestRequest,
    ): Promise<SendTestResponse> {
        const newsletter = await this.findOrFail(id);
        const emails = [...new Set(request.emails.map(normalizeEmail))];
        const response: SendTestResponse = { sent: [], failed: [] };

        // One at a time: these go through the same paced account as the
        // real sends.
        for (const email of emails) {
            try {
                const rendered = this.renderService.render(
                    newsletter,
                    sampleRecipient(email),
                    { mode: 'test' },
                );
                await this.mailer.send({
                    to: email,
                    subject: rendered.subject,
                    html: rendered.html,
                    text: rendered.text,
                    headers: rendered.headers,
                    replyTo: newsletter.replyTo,
                });
                response.sent.push(email);
            } catch (error) {
                response.failed.push({
                    email,
                    error: describeSmtpError(error),
                });
            }
        }
        return response;
    }

    /** DRAFT -> SCHEDULED when `scheduledAt` is given (it must be in the future), else SENDING. */
    async send(
        id: string,
        request: SendNewsletterRequest,
    ): Promise<NewsletterDetailResponse> {
        const now = new Date();
        const scheduledAt = request.scheduledAt
            ? new Date(request.scheduledAt)
            : null;
        if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
            throw new BadRequestException('scheduledAt is not a valid date');
        }
        if (scheduledAt && scheduledAt <= now) {
            throw new BadRequestException(
                'The scheduled time has already passed. Pick a time in the future, or send now.',
            );
        }

        const newsletter = await this.findOrFail(id);
        assertDraft(newsletter, 'sent');
        await this.assertReadyToSend(newsletter);

        await this.dbTransactionService.execute(async (manager) => {
            // Conditional, so two clicks on Send cannot queue it twice.
            const result = await manager.update(
                Newsletter,
                { id, status: NewsletterStatus.DRAFT },
                {
                    status: scheduledAt
                        ? NewsletterStatus.SCHEDULED
                        : NewsletterStatus.SENDING,
                    scheduledAt,
                    lastProgressAt: scheduledAt ? null : now,
                    pausedUntil: null,
                    pauseReason: null,
                    cancelledAt: null,
                },
            );
            if (!result.affected) {
                throw new ConflictException(
                    'Only a draft newsletter can be sent',
                );
            }
            await this.sendService.enqueue(id, scheduledAt ?? now, manager);
        });
        return this.get(id);
    }

    /** SCHEDULED -> DRAFT. The queued run finds a draft and does nothing. */
    async unschedule(id: string): Promise<NewsletterDetailResponse> {
        const result = await this.newsletterRepository.update(
            { id, status: NewsletterStatus.SCHEDULED },
            { status: NewsletterStatus.DRAFT, scheduledAt: null },
        );
        if (!result.affected) {
            await this.findOrFail(id);
            throw new ConflictException(
                'Only a scheduled newsletter can be unscheduled',
            );
        }
        return this.get(id);
    }

    /**
     * SENDING or SCHEDULED -> CANCELLED. Every delivery not yet sent becomes
     * SKIPPED, including any claimed by a batch in flight; that batch checks
     * before each email and stops.
     */
    async cancel(id: string): Promise<NewsletterDetailResponse> {
        await this.dbTransactionService.execute(async (manager) => {
            const result = await manager.update(
                Newsletter,
                {
                    id,
                    status: In([
                        NewsletterStatus.SENDING,
                        NewsletterStatus.SCHEDULED,
                    ]),
                },
                {
                    status: NewsletterStatus.CANCELLED,
                    cancelledAt: new Date(),
                    pausedUntil: null,
                    pauseReason: null,
                },
            );
            if (!result.affected) {
                if (!(await manager.exists(Newsletter, { where: { id } }))) {
                    throw new NotFoundException('Newsletter not found');
                }
                throw new ConflictException(
                    'Only a sending or scheduled newsletter can be cancelled',
                );
            }
            await manager
                .createQueryBuilder()
                .update(NewsletterDelivery)
                .set({
                    status: NewsletterDeliveryStatus.SKIPPED,
                    error: 'Cancelled',
                    claimedAt: null,
                })
                .where('"newsletterId" = :id', { id })
                .andWhere('status IN (:...statuses)', {
                    statuses: [
                        NewsletterDeliveryStatus.PENDING,
                        NewsletterDeliveryStatus.SENDING,
                    ],
                })
                .execute();
        });
        return this.get(id);
    }

    /**
     * SENT or SENDING: FAILED deliveries to addresses that may still receive
     * it (ACTIVE, and still on one of its lists or an ad-hoc recipient) go
     * back to PENDING with fresh attempts, and sending resumes. Bounced,
     * unsubscribed and erased addresses stay failed.
     */
    async retryFailed(id: string): Promise<NewsletterDetailResponse> {
        await this.dbTransactionService.execute(async (manager) => {
            const newsletter = await manager.findOne(Newsletter, {
                where: { id },
                lock: { mode: 'pessimistic_write' },
            });
            if (!newsletter)
                throw new NotFoundException('Newsletter not found');
            if (
                newsletter.status !== NewsletterStatus.SENT &&
                newsletter.status !== NewsletterStatus.SENDING
            ) {
                throw new ConflictException(
                    'Only a sent or sending newsletter can retry failed deliveries',
                );
            }

            // The same rule the send loop applies before every batch.
            const [, retried]: [unknown, number] = await manager.query(
                `
                UPDATE "newsletter_delivery" AS d
                SET "status" = '${NewsletterDeliveryStatus.PENDING}',
                    "attempts" = 0,
                    "error" = NULL,
                    "claimedAt" = NULL
                WHERE d."newsletterId" = $1
                  AND d."status" = '${NewsletterDeliveryStatus.FAILED}'
                  AND (${DELIVERY_STILL_WANTED_SQL})
                `,
                [id],
            );
            if (!retried) {
                throw new BadRequestException(
                    'No failed deliveries to retry. Bounced and unsubscribed addresses are not retried.',
                );
            }

            const now = new Date();
            await manager.update(
                Newsletter,
                { id },
                {
                    status: NewsletterStatus.SENDING,
                    sentAt: null,
                    lastProgressAt: now,
                },
            );
            await this.sendService.enqueue(id, now, manager);
        });
        return this.get(id);
    }

    async listDeliveries(
        id: string,
        query: ListNewsletterDeliveriesQuery,
    ): Promise<PaginatedData<NewsletterDeliveryResponse>> {
        await this.findOrFail(id);
        const page = query.page ?? 0;
        const pageSize = query.pageSize ?? 10;
        const qb = this.deliveryRepository
            .createQueryBuilder('delivery')
            .where('"delivery"."newsletterId" = :id', { id });

        if (query.status) {
            qb.andWhere('delivery.status = :status', {
                status: query.status,
            });
        }
        if (query.search) {
            qb.andWhere(
                new Brackets((w) =>
                    w
                        .where('delivery.email ILIKE :search')
                        .orWhere('delivery.name ILIKE :search'),
                ),
                { search: `%${escapeLikePattern(query.search)}%` },
            );
        }

        const [deliveries, totalRecords] = await qb
            .orderBy('delivery.email', 'ASC')
            .skip(page * pageSize)
            .take(pageSize)
            .getManyAndCount();

        return new PaginatedDataDto({
            totalRecords,
            records: deliveries.map(toDeliveryResponse),
        });
    }

    async getSettings(): Promise<NewsletterSettingsResponse> {
        const from = this.mailer.getFrom();
        return {
            fromEmail: from.email,
            fromName: from.name,
            replyTo: this.mailer.getDefaultReplyTo(),
            dailyLimit: this.dailyLimit,
            ratePerMinute: this.ratePerMinute,
            sentLast24h: await this.sendService.countSentLast24h(),
            usesDedicatedTransport: this.mailer.usesDedicatedTransport(),
            apiBaseUrl: this.urlService.getApiBaseUrl(),
            frontendUrl: this.urlService.getFrontendUrl(),
        };
    }

    // --- Helpers ---

    private async findOrFail(id: string): Promise<Newsletter> {
        const newsletter = await this.newsletterRepository.findOne({
            where: { id },
            relations: { lists: true, createdBy: true },
        });
        if (!newsletter) throw new NotFoundException('Newsletter not found');
        return newsletter;
    }

    /** The request's fields, normalised and checked. Absent stays absent. */
    private async validatedFields(
        request: CreateNewsletterRequest,
    ): Promise<NewsletterFields> {
        const fields: NewsletterFields = {};
        if (request.subject !== undefined) fields.subject = request.subject;
        if (request.preheader !== undefined) {
            fields.preheader = request.preheader?.trim() || null;
        }
        if (request.contentFormat !== undefined) {
            fields.contentFormat = request.contentFormat;
        }
        if (request.content !== undefined) fields.content = request.content;
        if (request.replyTo !== undefined) {
            fields.replyTo = request.replyTo
                ? normalizeEmail(request.replyTo)
                : null;
        }
        if (request.trackingEnabled !== undefined) {
            fields.trackingEnabled = request.trackingEnabled;
        }
        if (request.adHocEmails !== undefined) {
            fields.adHocEmails = normalizeAdHocEmails(request.adHocEmails);
        }
        if (request.listIds !== undefined) {
            fields.lists = await this.findSendableLists(request.listIds);
        }
        return fields;
    }

    private async findSendableLists(listIds: string[]): Promise<MailingList[]> {
        const ids = [...new Set(listIds)];
        if (ids.length === 0) return [];
        const lists = await this.mailingListRepository.find({
            where: { id: In(ids) },
        });
        if (lists.length !== ids.length) {
            throw new BadRequestException(
                'One or more mailing lists do not exist',
            );
        }
        const archived = lists.filter((list) => list.archivedAt);
        if (archived.length > 0) {
            throw new BadRequestException(
                `Archived lists cannot be sent to: ${archived.map((l) => l.name).join(', ')}`,
            );
        }
        return lists;
    }

    private async assertReadyToSend(newsletter: Newsletter): Promise<void> {
        if (!newsletter.subject.trim()) {
            throw new BadRequestException('Add a subject before sending');
        }
        if (!hasContent(newsletter.content)) {
            throw new BadRequestException('Add some content before sending');
        }
        // A typo such as {{firstname}} would reach the whole list as written.
        const unknownTags = findUnknownMergeTags([
            newsletter.subject,
            newsletter.preheader ?? '',
            newsletter.content,
        ]);
        if (unknownTags.length > 0) {
            const shown = unknownTags.slice(0, 10).join(', ');
            const more =
                unknownTags.length > 10
                    ? ` and ${unknownTags.length - 10} more`
                    : '';
            throw new BadRequestException(
                `Unknown merge tag(s): ${shown}${more}. Supported: ${NEWSLETTER_MERGE_TAGS.map((tag) => `{{${tag}}}`).join(', ')}.`,
            );
        }
        const archived = newsletter.lists.filter((list) => list.archivedAt);
        if (archived.length > 0) {
            throw new BadRequestException(
                `Remove the archived list(s) before sending: ${archived.map((l) => l.name).join(', ')}`,
            );
        }
        const audience = await this.subscriptionService.resolveAudience(
            newsletter.lists.map((list) => list.id),
            newsletter.adHocEmails,
            { dryRun: true },
        );
        if (audience.recipients.length === 0) {
            throw new BadRequestException(
                newsletter.lists.length === 0 &&
                    newsletter.adHocEmails.length === 0
                    ? 'Choose at least one list or add recipients before sending'
                    : 'Nobody would receive this newsletter: its lists have no active subscribers and no ad-hoc recipient can be sent to',
            );
        }
    }

    /** Whole days the send will take under the daily limit and pacing. */
    private estimateDays(willSend: number, sentLast24h: number): number {
        if (willSend === 0) return 0;
        const perDay = Math.min(this.dailyLimit, this.ratePerMinute * 60 * 24);
        const today = Math.min(
            perDay,
            Math.max(0, this.dailyLimit - sentLast24h),
        );
        if (willSend <= today) return 1;
        return 1 + Math.ceil((willSend - today) / perDay);
    }

    /** One grouped query for every newsletter on the page. */
    private async loadStats(
        newsletterIds: string[],
    ): Promise<Map<string, NewsletterStats>> {
        const stats = new Map<string, NewsletterStats>();
        if (newsletterIds.length === 0) return stats;

        const rows: {
            newsletterId: string;
            status: NewsletterDeliveryStatus;
            count: number;
            opened: number;
            clicked: number;
        }[] = await this.deliveryRepository.query(
            `
            SELECT "newsletterId",
                   "status",
                   COUNT(*)::int AS "count",
                   COUNT("openedAt")::int AS "opened",
                   (COUNT(*) FILTER (WHERE "clickCount" > 0))::int AS "clicked"
            FROM newsletter_delivery
            WHERE "newsletterId" = ANY($1::uuid[])
            GROUP BY "newsletterId", "status"
            `,
            [newsletterIds],
        );

        for (const row of rows) {
            const entry = stats.get(row.newsletterId) ?? { ...EMPTY_STATS };
            const count = Number(row.count);
            entry.total += count;
            entry.opened += Number(row.opened);
            entry.clicked += Number(row.clicked);
            switch (row.status) {
                case NewsletterDeliveryStatus.PENDING:
                case NewsletterDeliveryStatus.SENDING:
                    entry.pending += count;
                    break;
                case NewsletterDeliveryStatus.SENT:
                    entry.sent += count;
                    break;
                case NewsletterDeliveryStatus.FAILED:
                    entry.failed += count;
                    break;
                case NewsletterDeliveryStatus.SKIPPED:
                    entry.skipped += count;
                    break;
            }
            stats.set(row.newsletterId, entry);
        }
        return stats;
    }
}

function assertDraft(newsletter: Newsletter, action: string): void {
    if (newsletter.status !== NewsletterStatus.DRAFT) {
        throw new ConflictException(
            `Only a draft newsletter can be ${action}; this one is ${newsletter.status.toLowerCase()}`,
        );
    }
}

/** An empty editor still leaves markup behind (`<p></p>`). */
function hasContent(content: string): boolean {
    if (/<(img|hr|table)\b/i.test(content)) return true;
    // No `<` after the last `>` can start a tag. Stripping only up to there
    // keeps `<[^>]*>` from rescanning to the end from each of them, which is
    // quadratic on a long run of unclosed `<`.
    const tagsEnd = content.lastIndexOf('>') + 1;
    const text =
        content.slice(0, tagsEnd).replace(/<[^>]*>/g, '') +
        content.slice(tagsEnd);
    return text.replace(/&nbsp;|&#160;/gi, ' ').trim() !== '';
}

function normalizeAdHocEmails(emails: string[]): string[] {
    const normalized = [
        ...new Set(emails.map(normalizeEmail).filter((email) => email !== '')),
    ];
    const invalid = normalized.filter((email) => !isValidEmail(email));
    if (invalid.length > 0) {
        const shown = invalid.slice(0, 10).join(', ');
        const more =
            invalid.length > 10 ? ` and ${invalid.length - 10} more` : '';
        throw new BadRequestException(
            `Invalid email address(es): ${shown}${more}`,
        );
    }
    if (normalized.length > NEWSLETTER_MAX_IMPORT_SUBSCRIBERS) {
        throw new BadRequestException(
            `At most ${NEWSLETTER_MAX_IMPORT_SUBSCRIBERS} ad-hoc recipients`,
        );
    }
    return normalized;
}

function toSummary(
    newsletter: Newsletter,
    stats: NewsletterStats = EMPTY_STATS,
): NewsletterSummaryResponse {
    return {
        id: newsletter.id,
        subject: newsletter.subject,
        status: newsletter.status,
        contentFormat: newsletter.contentFormat,
        listNames: (newsletter.lists ?? [])
            .map((list) => list.name)
            .sort((a, b) => a.localeCompare(b)),
        adHocCount: newsletter.adHocEmails.length,
        trackingEnabled: newsletter.trackingEnabled,
        scheduledAt: toIso(newsletter.scheduledAt),
        sendStartedAt: toIso(newsletter.sendStartedAt),
        sentAt: toIso(newsletter.sentAt),
        pausedUntil: toIso(newsletter.pausedUntil),
        pauseReason: newsletter.pauseReason,
        stats: { ...stats },
        createdByName: newsletter.createdBy?.displayName ?? null,
        createdAt: newsletter.createdAt.toISOString(),
        updatedAt: newsletter.updatedAt.toISOString(),
    };
}

function toDetail(
    newsletter: Newsletter,
    stats?: NewsletterStats,
): NewsletterDetailResponse {
    return {
        ...toSummary(newsletter, stats),
        preheader: newsletter.preheader,
        content: newsletter.content,
        replyTo: newsletter.replyTo,
        listIds: (newsletter.lists ?? []).map((list) => list.id),
        adHocEmails: newsletter.adHocEmails,
    };
}

function toDeliveryResponse(
    delivery: NewsletterDelivery,
): NewsletterDeliveryResponse {
    return {
        id: delivery.id,
        email: delivery.email,
        name: delivery.name,
        status: delivery.status,
        error: delivery.error,
        attempts: delivery.attempts,
        sentAt: toIso(delivery.sentAt),
        openedAt: toIso(delivery.openedAt),
        openCount: delivery.openCount,
        clickCount: delivery.clickCount,
    };
}

function toIso(date: Date | null): string | null {
    return date ? date.toISOString() : null;
}
