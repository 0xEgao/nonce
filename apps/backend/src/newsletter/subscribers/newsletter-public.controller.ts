import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Put,
    Query,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
    ConfirmSubscriptionResponse,
    PublicMailingListResponse,
    PublicSubscribeResponse,
    SubscriberPreferencesResponse,
    UnsubscribeResponse,
} from '@nonce/shared';
import { Public } from '@/auth/public-route.decorator';
import { NEWSLETTER_SUBSCRIBE_MESSAGE } from '@/newsletter/newsletter.constants';
import {
    ConfirmSubscriptionRequestDto,
    PublicPreferencesQueryDto,
    PublicSubscribeRequestDto,
    PublicUpdatePreferencesRequestDto,
    UnsubscribeRequestDto,
} from '@/newsletter/subscribers/subscription.request.dto';
import { SubscriptionService } from '@/newsletter/subscribers/subscription.service';

const PER_MINUTE = 60_000;

// Subscribe, confirm, preferences and unsubscribe, authorised by the
// subscriber token rather than a session. `newsletter/public/t/*` (tracking)
// and `newsletter/public/images/*` live in their own controllers.
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@ApiTags('Newsletter')
@Public()
@Controller('newsletter/public')
export class NewsletterPublicController {
    constructor(private readonly subscriptionService: SubscriptionService) {}

    @Get('lists')
    @ApiOperation({ summary: 'Public, non-archived mailing lists' })
    @Throttle({ default: { limit: 60, ttl: PER_MINUTE } })
    async listPublicLists(): Promise<PublicMailingListResponse[]> {
        return this.subscriptionService.listPublicLists();
    }

    // Every sign-up can email a stranger, so this is the tightest limit here.
    @Post('subscribe')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({
        summary:
            'Sign up to public lists (double opt-in). Always the same 202 body.',
    })
    @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
    async subscribe(
        @Body() body: PublicSubscribeRequestDto,
    ): Promise<PublicSubscribeResponse> {
        await this.subscriptionService.subscribe(body);
        return { message: NEWSLETTER_SUBSCRIBE_MESSAGE };
    }

    @Post('confirm')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Confirm every pending subscription' })
    @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
    async confirm(
        @Body() body: ConfirmSubscriptionRequestDto,
    ): Promise<ConfirmSubscriptionResponse> {
        return this.subscriptionService.confirm(body.token);
    }

    @Get('preferences')
    @ApiOperation({ summary: "A subscriber's lists, by token" })
    @Throttle({ default: { limit: 30, ttl: PER_MINUTE } })
    async getPreferences(
        @Query() query: PublicPreferencesQueryDto,
    ): Promise<SubscriberPreferencesResponse> {
        return this.subscriptionService.getPreferencesByToken(query.token);
    }

    @Put('preferences')
    @ApiOperation({ summary: "Replace a subscriber's lists, by token" })
    @Throttle({ default: { limit: 20, ttl: PER_MINUTE } })
    async updatePreferences(
        @Body() body: PublicUpdatePreferencesRequestDto,
    ): Promise<SubscriberPreferencesResponse> {
        return this.subscriptionService.updatePreferencesByToken(body.token, {
            subscribedListIds: body.subscribedListIds,
            unsubscribeAll: body.unsubscribeAll,
        });
    }

    @Post('unsubscribe')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: "Unsubscribe from a newsletter's lists, or from everything",
    })
    @Throttle({ default: { limit: 10, ttl: PER_MINUTE } })
    async unsubscribe(
        @Body() body: UnsubscribeRequestDto,
    ): Promise<UnsubscribeResponse> {
        return this.subscriptionService.unsubscribe(body);
    }

    // RFC 8058: mail clients POST `List-Unsubscribe=One-Click` as a form body
    // to the URL from the List-Unsubscribe header, which carries everything we
    // need, so the body is never read. Always a bare 200, so the outcome says
    // nothing about the token. The generous limit is because these arrive from
    // the mailbox provider's servers, many recipients sharing a few IPs.
    @Post('unsubscribe/one-click')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'RFC 8058 one-click unsubscribe' })
    @Throttle({ default: { limit: 600, ttl: PER_MINUTE } })
    async unsubscribeOneClick(
        @Query('token') token?: string,
        @Query('n') newsletterId?: string,
    ): Promise<void> {
        await this.subscriptionService.unsubscribeOneClick(
            typeof token === 'string' ? token : '',
            typeof newsletterId === 'string' ? newsletterId : undefined,
        );
    }
}
