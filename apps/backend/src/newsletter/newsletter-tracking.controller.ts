import {
    Controller,
    Get,
    Header,
    HttpRedirectResponse,
    HttpStatus,
    Logger,
    Param,
    Redirect,
    StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '@/auth/public-route.decorator';
import { NewsletterTrackingService } from '@/newsletter/newsletter-tracking.service';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';

// A 1x1 transparent GIF.
const TRANSPARENT_GIF = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64',
);

// Kept to a plain run of digits so `1e1`, `0x1`, ` 1` and `-0` never parse
// into an index.
const LINK_INDEX = /^\d{1,6}$/;

// Open pixel (`o/:deliveryId.gif`) and click redirect
// (`c/:deliveryId/:linkIndex`). Hit by mail clients, never by our UI. Neither
// is throttled: a whole audience opens the same send within minutes, and often
// from one mail-proxy address.
@ApiTags('Newsletter')
@Public()
@SkipThrottle()
@Controller('newsletter/public/t')
export class NewsletterTrackingController {
    private readonly logger = new Logger(NewsletterTrackingController.name);

    constructor(
        private readonly service: NewsletterTrackingService,
        private readonly urlService: NewsletterUrlService,
    ) {}

    // `:deliveryId.gif` works on Express 5 (path-to-regexp 8): a parameter name
    // ends at the first character that is not a word character.
    @Get('o/:deliveryId.gif')
    @ApiOperation({ summary: 'Open-tracking pixel' })
    @Header('Cache-Control', 'no-store, private')
    async openPixel(
        @Param('deliveryId') deliveryId: string,
    ): Promise<StreamableFile> {
        // Whatever goes wrong, the mail client gets its image.
        try {
            await this.service.recordOpen(deliveryId);
        } catch (error) {
            this.logger.warn(
                `Open tracking failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return new StreamableFile(TRANSPARENT_GIF, {
            type: 'image/gif',
            length: TRANSPARENT_GIF.length,
        });
    }

    @Get('c/:deliveryId/:linkIndex')
    @ApiOperation({ summary: 'Click-tracking redirect' })
    @Header('Cache-Control', 'no-store, private')
    @Redirect()
    async click(
        @Param('deliveryId') deliveryId: string,
        @Param('linkIndex') linkIndex: string,
    ): Promise<HttpRedirectResponse> {
        // The destination is read from the database or is our own frontend,
        // never taken from the request, so this cannot serve as an open
        // redirect.
        const home = this.urlService.getFrontendUrl();
        const index = LINK_INDEX.test(linkIndex) ? Number(linkIndex) : null;
        const url =
            index === null
                ? null
                : await this.service.recordClick(deliveryId, index);
        return { url: url ?? home, statusCode: HttpStatus.FOUND };
    }
}
