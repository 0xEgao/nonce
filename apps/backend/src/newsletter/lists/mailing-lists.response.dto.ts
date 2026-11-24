import type {
    ListSubscriberResponse,
    MailingListResponse,
} from '@nonce/shared';
import {
    SubscriberStatus,
    SubscriptionSource,
    SubscriptionStatus,
} from '@/common/enum';
import { MailingList } from '@/entities/mailing-list.entity';
import { MailingListSubscription } from '@/entities/mailing-list-subscription.entity';

export interface MailingListCounts {
    subscriberCount: number;
    pendingCount: number;
    unsubscribedCount: number;
}

export const EMPTY_MAILING_LIST_COUNTS: MailingListCounts = {
    subscriberCount: 0,
    pendingCount: 0,
    unsubscribedCount: 0,
};

export class MailingListResponseDto implements MailingListResponse {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    isPublic: boolean;
    archivedAt: string | null;
    subscriberCount: number;
    pendingCount: number;
    unsubscribedCount: number;
    createdAt: string;

    constructor(
        list: MailingList,
        counts: MailingListCounts = EMPTY_MAILING_LIST_COUNTS,
    ) {
        this.id = list.id;
        this.name = list.name;
        this.slug = list.slug;
        this.description = list.description;
        this.isPublic = list.isPublic;
        this.archivedAt = list.archivedAt?.toISOString() ?? null;
        this.subscriberCount = counts.subscriberCount;
        this.pendingCount = counts.pendingCount;
        this.unsubscribedCount = counts.unsubscribedCount;
        this.createdAt = list.createdAt.toISOString();
    }
}

export class ListSubscriberResponseDto implements ListSubscriberResponse {
    subscriptionId: string;
    subscriberId: string;
    email: string;
    name: string | null;
    subscriptionStatus: SubscriptionStatus;
    subscriberStatus: SubscriberStatus;
    source: SubscriptionSource;
    createdAt: string;
    confirmedAt: string | null;
    unsubscribedAt: string | null;

    /** Expects `subscription.subscriber` loaded. */
    constructor(subscription: MailingListSubscription) {
        this.subscriptionId = subscription.id;
        this.subscriberId = subscription.subscriber.id;
        this.email = subscription.subscriber.email;
        this.name = subscription.subscriber.name;
        this.subscriptionStatus = subscription.status;
        this.subscriberStatus = subscription.subscriber.status;
        this.source = subscription.source;
        this.createdAt = subscription.createdAt.toISOString();
        this.confirmedAt = subscription.confirmedAt?.toISOString() ?? null;
        this.unsubscribedAt =
            subscription.unsubscribedAt?.toISOString() ?? null;
    }
}
