import type {
    PublicMailingListResponse,
    SubscriberPreferenceList,
} from '@nonce/shared';
import { SubscriptionStatus } from '@/common/enum';
import { MailingList } from '@/entities/mailing-list.entity';

export class PublicMailingListResponseDto implements PublicMailingListResponse {
    id: string;
    slug: string;
    name: string;
    description: string | null;

    constructor(list: MailingList) {
        this.id = list.id;
        this.slug = list.slug;
        this.name = list.name;
        this.description = list.description;
    }
}

export class SubscriberPreferenceListDto
    extends PublicMailingListResponseDto
    implements SubscriberPreferenceList
{
    status: SubscriptionStatus | null;

    constructor(list: MailingList, status: SubscriptionStatus | null) {
        super(list);
        this.status = status;
    }
}
