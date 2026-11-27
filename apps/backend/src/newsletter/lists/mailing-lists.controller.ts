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
    StreamableFile,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
    AddSubscribersResponse,
    ListSubscriberResponse,
    MailingListResponse,
    PaginatedData,
} from '@nonce/shared';
import { Roles } from '@/auth/roles.decorator';
import { UserRole } from '@/common/enum';
import {
    AddPortalUsersRequestDto,
    AddSubscribersRequestDto,
    CreateMailingListRequestDto,
    ListMailingListSubscribersQueryDto,
    ListMailingListsQueryDto,
    UpdateMailingListRequestDto,
} from '@/newsletter/lists/mailing-lists.request.dto';
import { MailingListsService } from '@/newsletter/lists/mailing-lists.service';

@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@ApiTags('Newsletter')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('newsletter/admin/lists')
export class MailingListsController {
    constructor(private readonly service: MailingListsService) {}

    @Get()
    @ApiOperation({ summary: 'Mailing lists with subscriber counts (admin)' })
    async list(
        @Query() query: ListMailingListsQueryDto,
    ): Promise<MailingListResponse[]> {
        return this.service.list(query);
    }

    @Post()
    @ApiOperation({ summary: 'Create a mailing list (admin)' })
    async create(
        @Body() body: CreateMailingListRequestDto,
    ): Promise<MailingListResponse> {
        return this.service.create(body);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a mailing list (admin)' })
    async get(
        @Param('id', new ParseUUIDPipe()) id: string,
    ): Promise<MailingListResponse> {
        return this.service.get(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Update or archive a mailing list (admin)' })
    async update(
        @Param('id', new ParseUUIDPipe()) id: string,
        @Body() body: UpdateMailingListRequestDto,
    ): Promise<MailingListResponse> {
        return this.service.update(id, body);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary: 'Delete a mailing list no newsletter uses (admin)',
    })
    async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
        await this.service.remove(id);
    }

    @Get(':id/subscribers')
    @ApiOperation({ summary: "A mailing list's subscriptions (admin)" })
    async listSubscribers(
        @Param('id', new ParseUUIDPipe()) id: string,
        @Query() query: ListMailingListSubscribersQueryDto,
    ): Promise<PaginatedData<ListSubscriberResponse>> {
        return this.service.listSubscribers(id, query);
    }

    @Get(':id/subscribers/export')
    @ApiOperation({ summary: "Download a mailing list's subscriptions as CSV" })
    async exportSubscribers(
        @Param('id', new ParseUUIDPipe()) id: string,
    ): Promise<StreamableFile> {
        const { fileName, content } = await this.service.exportSubscribers(id);
        return new StreamableFile(Buffer.from(content, 'utf8'), {
            type: 'text/csv; charset=utf-8',
            disposition: `attachment; filename="${fileName}"`,
        });
    }

    @Post(':id/subscribers')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Add up to 5,000 addresses as SUBSCRIBED (admin)',
    })
    async addSubscribers(
        @Param('id', new ParseUUIDPipe()) id: string,
        @Body() body: AddSubscribersRequestDto,
    ): Promise<AddSubscribersResponse> {
        return this.service.addSubscribers(id, body);
    }

    @Post(':id/subscribers/from-users')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Copy portal users into the list, or count them (admin)',
    })
    async addPortalUsers(
        @Param('id', new ParseUUIDPipe()) id: string,
        @Body() body: AddPortalUsersRequestDto,
    ): Promise<AddSubscribersResponse> {
        return this.service.addPortalUsers(id, body);
    }

    @Delete(':id/subscribers/:subscriptionId')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete one subscription row (admin)' })
    async removeSubscription(
        @Param('id', new ParseUUIDPipe()) id: string,
        @Param('subscriptionId', new ParseUUIDPipe()) subscriptionId: string,
    ): Promise<void> {
        await this.service.removeSubscription(id, subscriptionId);
    }
}
