import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    MaxLength,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type {
    AddPortalUsersRequest,
    AddSubscriberEntry,
    AddSubscribersRequest,
    CreateMailingListRequest,
    ListMailingListSubscribersQuery,
    ListMailingListsQuery,
    UpdateMailingListRequest,
} from '@nonce/shared';
import { PaginatedQueryDto } from '@/common/dto';
import { CohortType, PortalAudience, SubscriptionStatus } from '@/common/enum';
import {
    MAILING_LIST_NAME_MAX_LENGTH,
    MAILING_LIST_SLUG_MAX_LENGTH,
    NEWSLETTER_MAX_IMPORT_SUBSCRIBERS,
    SUBSCRIBER_NAME_MAX_LENGTH,
} from '@/newsletter/newsletter.constants';

// What slugify() produces: lowercase ASCII words joined by single hyphens.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESCRIPTION_MAX_LENGTH = 2000;
const SEARCH_MAX_LENGTH = 100;

const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

// Query strings carry booleans as text.
const toBoolean = ({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value;

export class ListMailingListsQueryDto implements ListMailingListsQuery {
    @IsOptional()
    @Transform(toBoolean)
    @IsBoolean()
    includeArchived?: boolean;
}

export class CreateMailingListRequestDto implements CreateMailingListRequest {
    @Transform(trim)
    @IsString()
    @IsNotEmpty()
    @MaxLength(MAILING_LIST_NAME_MAX_LENGTH)
    name!: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(MAILING_LIST_SLUG_MAX_LENGTH)
    @Matches(SLUG_PATTERN, {
        message:
            'slug must be lowercase letters and digits, separated by single hyphens',
    })
    slug?: string;

    @IsOptional()
    @IsString()
    @MaxLength(DESCRIPTION_MAX_LENGTH)
    description?: string;

    @IsOptional()
    @IsBoolean()
    isPublic?: boolean;
}

export class UpdateMailingListRequestDto implements UpdateMailingListRequest {
    // Absent leaves a field alone; null is only meaningful for description.
    @ValidateIf((_, value) => value !== undefined)
    @Transform(trim)
    @IsString()
    @IsNotEmpty()
    @MaxLength(MAILING_LIST_NAME_MAX_LENGTH)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(DESCRIPTION_MAX_LENGTH)
    description?: string | null;

    @ValidateIf((_, value) => value !== undefined)
    @IsBoolean()
    isPublic?: boolean;

    @ValidateIf((_, value) => value !== undefined)
    @IsBoolean()
    archived?: boolean;
}

export class ListMailingListSubscribersQueryDto
    extends PaginatedQueryDto
    implements ListMailingListSubscribersQuery
{
    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(SEARCH_MAX_LENGTH)
    search?: string;

    @IsOptional()
    @IsEnum(SubscriptionStatus)
    status?: SubscriptionStatus;
}

export class AddSubscriberEntryDto implements AddSubscriberEntry {
    // Not @IsEmail: one bad row must not fail the whole import. The service
    // reports malformed addresses back in `invalid`.
    @IsString()
    @MaxLength(1000)
    email!: string;

    @IsOptional()
    @IsString()
    @MaxLength(SUBSCRIBER_NAME_MAX_LENGTH)
    name?: string;
}

export class AddSubscribersRequestDto implements AddSubscribersRequest {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(NEWSLETTER_MAX_IMPORT_SUBSCRIBERS)
    @ValidateNested({ each: true })
    @Type(() => AddSubscriberEntryDto)
    subscribers!: AddSubscriberEntryDto[];

    @IsOptional()
    @IsBoolean()
    resubscribe?: boolean;
}

export class AddPortalUsersRequestDto implements AddPortalUsersRequest {
    @IsEnum(PortalAudience)
    audience!: PortalAudience;

    @ValidateIf(
        (request: AddPortalUsersRequestDto) =>
            request.audience === PortalAudience.COHORT_MEMBERS ||
            request.cohortId !== undefined,
    )
    @IsUUID()
    cohortId?: string;

    @ValidateIf(
        (request: AddPortalUsersRequestDto) =>
            request.audience === PortalAudience.COHORT_TYPE_MEMBERS ||
            request.cohortType !== undefined,
    )
    @IsEnum(CohortType)
    cohortType?: CohortType;

    @IsOptional()
    @IsBoolean()
    dryRun?: boolean;

    @IsOptional()
    @IsBoolean()
    resubscribe?: boolean;
}
