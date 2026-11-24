import type { SubscriberResponse } from '@nonce/shared';
import { SubscriberStatus } from '@/common/enum';
import { Subscriber } from '@/entities/subscriber.entity';

export class SubscriberResponseDto implements SubscriberResponse {
    id: string;
    email: string;
    name: string | null;
    status: SubscriberStatus;
    statusReason: string | null;
    statusChangedAt: string | null;
    listCount: number;
    createdAt: string;

    constructor(subscriber: Subscriber, listCount: number) {
        this.id = subscriber.id;
        this.email = subscriber.email;
        this.name = subscriber.name;
        this.status = subscriber.status;
        this.statusReason = subscriber.statusReason;
        this.statusChangedAt =
            subscriber.statusChangedAt?.toISOString() ?? null;
        this.listCount = listCount;
        this.createdAt = subscriber.createdAt.toISOString();
    }
}
