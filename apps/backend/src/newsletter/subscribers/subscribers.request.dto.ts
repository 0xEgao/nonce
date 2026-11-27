import {
    IsEnum,
    IsOptional,
    IsString,
    MaxLength,
    ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type {
    ListSubscribersQuery,
    UpdateSubscriberRequest,
} from '@nonce/shared';
import { PaginatedQueryDto } from '@/common/dto';
import { SubscriberStatus } from '@/common/enum';
import { SUBSCRIBER_NAME_MAX_LENGTH } from '@/newsletter/newsletter.constants';

const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class ListSubscribersQueryDto
    extends PaginatedQueryDto
    implements ListSubscribersQuery
{
    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(100)
    search?: string;

    @IsOptional()
    @IsEnum(SubscriberStatus)
    status?: SubscriberStatus;
}

export class UpdateSubscriberRequestDto implements UpdateSubscriberRequest {
    // Absent leaves it alone; unlike name, null is not a value.
    @ValidateIf((_, value) => value !== undefined)
    @IsEnum(SubscriberStatus)
    status?: SubscriberStatus;

    // Null (or blank) clears it.
    @IsOptional()
    @IsString()
    @MaxLength(SUBSCRIBER_NAME_MAX_LENGTH)
    name?: string | null;
}
