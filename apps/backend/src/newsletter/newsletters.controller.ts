import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
    NewsletterAudienceResponse,
    NewsletterDeliveryResponse,
    NewsletterDetailResponse,
    NewsletterPreviewResponse,
    NewsletterSettingsResponse,
    NewsletterSummaryResponse,
    PaginatedData,
    SendTestResponse,
} from '@nonce/shared';
import { Roles } from '@/auth/roles.decorator';
import { UserRole } from '@/common/enum';
import { GetUser } from '@/decorators/user.decorator';
import { User } from '@/entities/user.entity';
import { NewslettersService } from '@/newsletter/newsletters.service';
import {
    CreateNewsletterRequestDto,
    ListNewsletterDeliveriesQueryDto,
    ListNewslettersQueryDto,
    PreviewNewsletterRequestDto,
    SendNewsletterRequestDto,
    SendTestRequestDto,
    UpdateNewsletterRequestDto,
} from '@/newsletter/newsletters.request.dto';

// Routes: `newsletters`, `newsletters/:id/...` and `settings`. Lists,
// subscribers and images under `newsletter/admin` have their own controllers.
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@ApiTags('Newsletter')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('newsletter/admin')
export class NewslettersController {
    constructor(private readonly newslettersService: NewslettersService) {}

    @Get('newsletters')
    @ApiOperation({ summary: 'Newsletters, newest first, with delivery stats' })
    async list(
        @Query() query: ListNewslettersQueryDto,
    ): Promise<PaginatedData<NewsletterSummaryResponse>> {
        return this.newslettersService.list(query);
    }

    @Post('newsletters')
    @ApiOperation({ summary: 'Create a draft newsletter' })
    async create(
        @Body() body: CreateNewsletterRequestDto,
        @GetUser() user: User,
    ): Promise<NewsletterDetailResponse> {
        return this.newslettersService.create(body, user);
    }

    @Get('newsletters/:id')
    async get(
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<NewsletterDetailResponse> {
        return this.newslettersService.get(id);
    }

    @Patch('newsletters/:id')
    @ApiOperation({ summary: 'Edit a draft; 409 once it is not a draft' })
    async update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: UpdateNewsletterRequestDto,
    ): Promise<NewsletterDetailResponse> {
        return this.newslettersService.update(id, body);
    }

    @Delete('newsletters/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a draft' })
    async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
        return this.newslettersService.remove(id);
    }

    @Post('newsletters/:id/duplicate')
    @ApiOperation({ summary: 'Copy content and audience into a new draft' })
    async duplicate(
        @Param('id', ParseUUIDPipe) id: string,
        @GetUser() user: User,
    ): Promise<NewsletterDetailResponse> {
        return this.newslettersService.duplicate(id, user);
    }

    @Post('newsletters/:id/preview')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Render for a sample recipient, with optional unsaved edits',
    })
    async preview(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: PreviewNewsletterRequestDto,
    ): Promise<NewsletterPreviewResponse> {
        return this.newslettersService.preview(id, body);
    }

    @Get('newsletters/:id/audience')
    @ApiOperation({
        summary: 'Who a send would reach now, and how long it would take',
    })
    async getAudience(
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<NewsletterAudienceResponse> {
        return this.newslettersService.getAudience(id);
    }

    @Post('newsletters/:id/test')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Send a [TEST] copy to up to 10 addresses',
        description: 'Reports success per address; never touches deliveries.',
    })
    async sendTest(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: SendTestRequestDto,
    ): Promise<SendTestResponse> {
        return this.newslettersService.sendTest(id, body);
    }

    @Post('newsletters/:id/send')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Send now, or schedule with a future scheduledAt',
    })
    async send(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: SendNewsletterRequestDto,
    ): Promise<NewsletterDetailResponse> {
        return this.newslettersService.send(id, body);
    }

    @Post('newsletters/:id/unschedule')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Scheduled back to draft' })
    async unschedule(
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<NewsletterDetailResponse> {
        return this.newslettersService.unschedule(id);
    }

    @Post('newsletters/:id/cancel')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary:
            'Stop a sending or scheduled newsletter; unsent deliveries are skipped',
    })
    async cancel(
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<NewsletterDetailResponse> {
        return this.newslettersService.cancel(id);
    }

    @Post('newsletters/:id/retry-failed')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Re-queue failed deliveries to still-active addresses',
    })
    async retryFailed(
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<NewsletterDetailResponse> {
        return this.newslettersService.retryFailed(id);
    }

    @Get('newsletters/:id/deliveries')
    async listDeliveries(
        @Param('id', ParseUUIDPipe) id: string,
        @Query() query: ListNewsletterDeliveriesQueryDto,
    ): Promise<PaginatedData<NewsletterDeliveryResponse>> {
        return this.newslettersService.listDeliveries(id, query);
    }

    @Get('settings')
    @ApiOperation({ summary: 'Sender, limits and today’s usage' })
    async getSettings(): Promise<NewsletterSettingsResponse> {
        return this.newslettersService.getSettings();
    }
}
