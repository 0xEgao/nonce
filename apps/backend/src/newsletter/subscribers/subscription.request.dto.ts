import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type {
    ConfirmSubscriptionRequest,
    PublicPreferencesQuery,
    PublicSubscribeRequest,
    PublicUpdatePreferencesRequest,
    UnsubscribeRequest,
    UpdatePreferencesRequest,
} from '@nonce/shared';
import {
    EMAIL_MAX_LENGTH,
    MAILING_LIST_SLUG_MAX_LENGTH,
    SUBSCRIBER_NAME_MAX_LENGTH,
} from '@/newsletter/newsletter.constants';

// Subscriber tokens are 43 characters; the column allows 64.
const TOKEN_MAX_LENGTH = 64;

const trim = ({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value;

export class PublicSubscribeRequestDto implements PublicSubscribeRequest {
    @Transform(trim)
    @IsEmail()
    @MaxLength(EMAIL_MAX_LENGTH)
    email!: string;

    @IsOptional()
    @Transform(trim)
    @IsString()
    @MaxLength(SUBSCRIBER_NAME_MAX_LENGTH)
    name?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(20)
    @IsString({ each: true })
    @MaxLength(MAILING_LIST_SLUG_MAX_LENGTH, { each: true })
    listSlugs!: string[];

    // The honeypot. Deliberately unconstrained beyond being a string, so a
    // bot that fills it in gets the same 202 as everyone else.
    @IsOptional()
    @IsString()
    website?: string;
}

class TokenDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(TOKEN_MAX_LENGTH)
    token!: string;
}

export class ConfirmSubscriptionRequestDto
    extends TokenDto
    implements ConfirmSubscriptionRequest {}

export class PublicPreferencesQueryDto
    extends TokenDto
    implements PublicPreferencesQuery {}

export class UpdatePreferencesRequestDto implements UpdatePreferencesRequest {
    @IsArray()
    @ArrayMaxSize(500)
    @IsUUID('all', { each: true })
    subscribedListIds!: string[];

    @IsOptional()
    @IsBoolean()
    unsubscribeAll?: boolean;
}

export class PublicUpdatePreferencesRequestDto
    extends UpdatePreferencesRequestDto
    implements PublicUpdatePreferencesRequest
{
    @IsString()
    @IsNotEmpty()
    @MaxLength(TOKEN_MAX_LENGTH)
    token!: string;
}

export class UnsubscribeRequestDto
    extends TokenDto
    implements UnsubscribeRequest
{
    @IsOptional()
    @IsUUID()
    newsletterId?: string;

    @IsOptional()
    @IsBoolean()
    all?: boolean;
}
