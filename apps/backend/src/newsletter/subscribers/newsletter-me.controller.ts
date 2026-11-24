import {
    Controller,
    HttpCode,
    HttpStatus,
    Post,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { PreferencesLinkResponse } from '@nonce/shared';
import { GetUser } from '@/decorators/user.decorator';
import { User } from '@/entities/user.entity';
import { NEWSLETTER_PREFERENCES_LINK_MESSAGE } from '@/newsletter/newsletter.constants';
import { SubscriptionService } from '@/newsletter/subscribers/subscription.service';

const PER_MINUTE = 60_000;

// The signed-in user's own email preferences, for any role. A user can put any
// address on their account, so the session never reads or changes an
// address's lists directly: it can only have that address mailed its link.
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@ApiTags('Newsletter')
@ApiBearerAuth()
@Controller('newsletter/me')
export class NewsletterMeController {
    constructor(private readonly subscriptionService: SubscriptionService) {}

    // Each call can email an address, so this is as tight as the public form.
    @Post('preferences-link')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({
        summary:
            'Email my account address a link to manage its newsletters. Always the same 202 body.',
    })
    @Throttle({ default: { limit: 5, ttl: PER_MINUTE } })
    async sendPreferencesLink(
        @GetUser() user: User,
    ): Promise<PreferencesLinkResponse> {
        await this.subscriptionService.sendPreferencesLink(user);
        return { message: NEWSLETTER_PREFERENCES_LINK_MESSAGE };
    }
}
