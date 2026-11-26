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
    Query,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PaginatedData, SubscriberResponse } from '@nonce/shared';
import { Roles } from '@/auth/roles.decorator';
import { UserRole } from '@/common/enum';
import {
    ListSubscribersQueryDto,
    UpdateSubscriberRequestDto,
} from '@/newsletter/subscribers/subscribers.request.dto';
import { SubscribersService } from '@/newsletter/subscribers/subscribers.service';

@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@ApiTags('Newsletter')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@Controller('newsletter/admin/subscribers')
export class SubscribersController {
    constructor(private readonly service: SubscribersService) {}

    @Get()
    @ApiOperation({ summary: 'Every subscriber address (admin)' })
    async list(
        @Query() query: ListSubscribersQueryDto,
    ): Promise<PaginatedData<SubscriberResponse>> {
        return this.service.list(query);
    }

    @Patch(':id')
    @ApiOperation({
        summary: 'Rename, suppress or reactivate an address (admin)',
    })
    async update(
        @Param('id', new ParseUUIDPipe()) id: string,
        @Body() body: UpdateSubscriberRequestDto,
    ): Promise<SubscriberResponse> {
        return this.service.update(id, body);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({
        summary:
            'Delete a subscriber and their subscriptions; past send history keeps the address (admin)',
    })
    async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
        await this.service.remove(id);
    }
}
