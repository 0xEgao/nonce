import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsEmail,
    IsEnum,
    IsISO8601,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    ValidateIf,
} from 'class-validator';
import type {
    CreateNewsletterRequest,
    ListNewsletterDeliveriesQuery,
    ListNewslettersQuery,
    PreviewNewsletterRequest,
    SendNewsletterRequest,
    SendTestRequest,
    UpdateNewsletterRequest,
} from '@nonce/shared';
import { PaginatedQueryDto } from '@/common/dto';
import {
    NewsletterContentFormat,
    NewsletterDeliveryStatus,
    NewsletterStatus,
} from '@/common/enum';
import {
    EMAIL_MAX_LENGTH,
    NEWSLETTER_MAX_IMPORT_SUBSCRIBERS,
    NEWSLETTER_MAX_TEST_RECIPIENTS,
    NEWSLETTER_PREHEADER_MAX_LENGTH,
    NEWSLETTER_SUBJECT_MAX_LENGTH,
} from '@/newsletter/newsletter.constants';

// Far beyond anything worth emailing (Gmail clips messages past ~100 KB), but
// a ceiling all the same.
export const NEWSLETTER_CONTENT_MAX_LENGTH = 500_000;
export const NEWSLETTER_MAX_LISTS = 100;
const SEARCH_MAX_LENGTH = 200;

// Absent leaves the field alone, but these columns are NOT NULL, so null is
// rejected rather than skipped the way @IsOptional() would.
const unlessAbsent = ValidateIf((_object, value) => value !== undefined);

export class ListNewslettersQueryDto
    extends PaginatedQueryDto
    implements ListNewslettersQuery
{
    @IsOptional()
    @IsEnum(NewsletterStatus)
    status?: NewsletterStatus;

    @IsOptional()
    @IsString()
    @MaxLength(SEARCH_MAX_LENGTH)
    search?: string;
}

export class CreateNewsletterRequestDto implements CreateNewsletterRequest {
    @unlessAbsent
    @IsString()
    @MaxLength(NEWSLETTER_SUBJECT_MAX_LENGTH)
    subject?: string;

    /** Null clears it. */
    @IsOptional()
    @IsString()
    @MaxLength(NEWSLETTER_PREHEADER_MAX_LENGTH)
    preheader?: string | null;

    @unlessAbsent
    @IsEnum(NewsletterContentFormat)
    contentFormat?: NewsletterContentFormat;

    @unlessAbsent
    @IsString()
    @MaxLength(NEWSLETTER_CONTENT_MAX_LENGTH)
    content?: string;

    /** Null means the configured default Reply-To. */
    @IsOptional()
    @IsEmail()
    @MaxLength(EMAIL_MAX_LENGTH)
    replyTo?: string | null;

    @unlessAbsent
    @IsArray()
    @ArrayMaxSize(NEWSLETTER_MAX_LISTS)
    @IsUUID('all', { each: true })
    listIds?: string[];

    /** Normalised, validated and de-duplicated by the service. */
    @unlessAbsent
    @IsArray()
    @ArrayMaxSize(NEWSLETTER_MAX_IMPORT_SUBSCRIBERS)
    @IsString({ each: true })
    @MaxLength(EMAIL_MAX_LENGTH, { each: true })
    adHocEmails?: string[];

    @unlessAbsent
    @IsBoolean()
    trackingEnabled?: boolean;
}

export class UpdateNewsletterRequestDto
    extends CreateNewsletterRequestDto
    implements UpdateNewsletterRequest {}

export class PreviewNewsletterRequestDto implements PreviewNewsletterRequest {
    @unlessAbsent
    @IsString()
    @MaxLength(NEWSLETTER_SUBJECT_MAX_LENGTH)
    subject?: string;

    @IsOptional()
    @IsString()
    @MaxLength(NEWSLETTER_PREHEADER_MAX_LENGTH)
    preheader?: string | null;

    @unlessAbsent
    @IsEnum(NewsletterContentFormat)
    contentFormat?: NewsletterContentFormat;

    @unlessAbsent
    @IsString()
    @MaxLength(NEWSLETTER_CONTENT_MAX_LENGTH)
    content?: string;
}

export class SendTestRequestDto implements SendTestRequest {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(NEWSLETTER_MAX_TEST_RECIPIENTS)
    @IsEmail({}, { each: true })
    @MaxLength(EMAIL_MAX_LENGTH, { each: true })
    emails!: string[];
}

export class SendNewsletterRequestDto implements SendNewsletterRequest {
    /** Must be in the future. Omit to send now. */
    @IsOptional()
    @IsISO8601({ strict: true })
    scheduledAt?: string;
}

export class ListNewsletterDeliveriesQueryDto
    extends PaginatedQueryDto
    implements ListNewsletterDeliveriesQuery
{
    @IsOptional()
    @IsEnum(NewsletterDeliveryStatus)
    status?: NewsletterDeliveryStatus;

    @IsOptional()
    @IsString()
    @MaxLength(SEARCH_MAX_LENGTH)
    search?: string;
}
