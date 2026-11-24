import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { NewsletterDelivery } from '@/entities/newsletter-delivery.entity';
import { isHttpUrl } from '@/newsletter/newsletter-tracking.util';

// Counters are bumped in the statement itself, never read-then-written: a
// popular newsletter gets many opens and clicks at the same moment. `openedAt`
// and `firstClickedAt` keep their first value.
const INCREMENT_OPEN_COUNT = () => '"openCount" + 1';
const INCREMENT_CLICK_COUNT = () => '"clickCount" + 1';
const KEEP_OR_SET_OPENED_AT = () => 'COALESCE("openedAt", now())';
const KEEP_OR_SET_FIRST_CLICKED_AT = () => 'COALESCE("firstClickedAt", now())';

@Injectable()
export class NewsletterTrackingService {
    private readonly logger = new Logger(NewsletterTrackingService.name);

    constructor(
        @InjectRepository(NewsletterDelivery)
        private readonly deliveryRepository: Repository<NewsletterDelivery>,
    ) {}

    /** Never rejects: a failed write must not break an image in someone's inbox. */
    async recordOpen(deliveryId: string): Promise<void> {
        if (!isUUID(deliveryId)) return;
        try {
            await this.deliveryRepository.update(
                { id: deliveryId },
                {
                    openCount: INCREMENT_OPEN_COUNT,
                    openedAt: KEEP_OR_SET_OPENED_AT,
                },
            );
        } catch (error) {
            this.logger.warn(
                `Could not record an open for delivery ${deliveryId}: ${errorMessage(error)}`,
            );
        }
    }

    /**
     * Records the click and returns the stored link, or null when the
     * delivery or index is unknown (the controller then redirects home).
     * The destination only ever comes from the newsletter's `trackedLinks`,
     * never from the request.
     */
    async recordClick(
        deliveryId: string,
        linkIndex: number,
    ): Promise<string | null> {
        if (!isUUID(deliveryId)) return null;
        if (!Number.isInteger(linkIndex) || linkIndex < 0) return null;

        const row = await this.deliveryRepository
            .createQueryBuilder('delivery')
            .innerJoin('delivery.newsletter', 'newsletter')
            .select('newsletter.trackedLinks', 'trackedLinks')
            .where('delivery.id = :id', { id: deliveryId })
            .getRawOne<{ trackedLinks: unknown }>();
        if (!row || !Array.isArray(row.trackedLinks)) return null;

        const link: unknown = row.trackedLinks[linkIndex];
        // Stored data is trusted less than it looks: a value that is not a
        // plain http(s) URL (`javascript:`, relative, ...) is never followed.
        if (!isHttpUrl(link)) return null;

        // The click still counts as an open: the image may have been blocked.
        try {
            await this.deliveryRepository.update(
                { id: deliveryId },
                {
                    clickCount: INCREMENT_CLICK_COUNT,
                    firstClickedAt: KEEP_OR_SET_FIRST_CLICKED_AT,
                    openedAt: KEEP_OR_SET_OPENED_AT,
                },
            );
        } catch (error) {
            // The person still deserves to reach the link.
            this.logger.warn(
                `Could not record a click for delivery ${deliveryId}: ${errorMessage(error)}`,
            );
        }
        return link;
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
