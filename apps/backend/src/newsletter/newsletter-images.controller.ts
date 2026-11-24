import {
    BadRequestException,
    Controller,
    Get,
    HttpStatus,
    Param,
    Post,
    Req,
    Res,
    StreamableFile,
    UploadedFile,
    UseInterceptors,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiBearerAuth,
    ApiBody,
    ApiConsumes,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { NewsletterImageResponse } from '@nonce/shared';
import { isUUID } from 'class-validator';
import { Request, Response } from 'express';
import { Public } from '@/auth/public-route.decorator';
import { Roles } from '@/auth/roles.decorator';
import { UserRole } from '@/common/enum';
import { GetUser } from '@/decorators/user.decorator';
import { User } from '@/entities/user.entity';
import {
    NEWSLETTER_IMAGE_MAX_BYTES,
    NEWSLETTER_IMAGE_MIME_TYPES,
} from '@/newsletter/newsletter.constants';
import { NewsletterImagesService } from '@/newsletter/newsletter-images.service';

// Rejects other types by their declared mime up front. That value is
// client-supplied, so the service also checks the file's magic bytes.
export const newsletterImageFileFilter = (
    _req: unknown,
    file: { mimetype: string },
    cb: (error: Error | null, acceptFile: boolean) => void,
): void => {
    if (!NEWSLETTER_IMAGE_MIME_TYPES.includes(file.mimetype)) {
        cb(
            new BadRequestException(
                'Only PNG, JPEG, GIF or WebP images are allowed',
            ),
            false,
        );
        return;
    }
    cb(null, true);
};

// Spans both halves of the API, so nothing is set at class level: the upload
// (`admin/images`) needs `@Roles(UserRole.ADMIN)` on the route, and the image
// itself (`public/images/:id`) needs `@Public()`.
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
@ApiTags('Newsletter')
@Controller('newsletter')
export class NewsletterImagesController {
    constructor(private readonly service: NewsletterImagesService) {}

    @Post('admin/images')
    @ApiOperation({ summary: 'Upload a newsletter image as `file` (admin)' })
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary' } },
        },
    })
    @Roles(UserRole.ADMIN)
    // FileInterceptor buffers in memory unless told otherwise, which is what
    // the service wants: the bytes go straight into the database.
    @UseInterceptors(
        FileInterceptor('file', {
            limits: { fileSize: NEWSLETTER_IMAGE_MAX_BYTES, files: 1 },
            fileFilter: newsletterImageFileFilter,
        }),
    )
    async uploadImage(
        @GetUser() user: User,
        @UploadedFile() file: Express.Multer.File,
    ): Promise<NewsletterImageResponse> {
        return this.service.upload(file, user);
    }

    // Loaded by every recipient's mail client, thousands of them often through
    // the same proxy, so it must not be throttled.
    @Get('public/images/:id')
    @ApiOperation({ summary: 'A newsletter image' })
    @Public()
    @SkipThrottle()
    async getImage(
        @Param('id') id: string,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<StreamableFile | undefined> {
        // The id names one upload whose bytes never change, so it is the
        // ETag, and a client revalidating its copy is answered without
        // loading anything.
        const etag = `"${id}"`;
        if (isUUID(id) && ifNoneMatchIncludes(req, etag)) {
            setImageCacheHeaders(res, etag);
            res.status(HttpStatus.NOT_MODIFIED);
            return undefined;
        }

        const image = await this.service.getImage(id);
        // Only now: a 404 must not be cached for a year.
        setImageCacheHeaders(res, etag);
        // The type was detected from the bytes at upload; never let a client
        // second-guess it.
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return new StreamableFile(image.data, {
            type: image.mimeType,
            length: image.data.length,
        });
    }
}

function setImageCacheHeaders(res: Response, etag: string): void {
    // The URL is permanent and the bytes never change under it.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
}

/** `If-None-Match` lists `etag`, strong or weak. `*` is not honoured. */
function ifNoneMatchIncludes(req: Request, etag: string): boolean {
    const header = req.headers['if-none-match'];
    if (!header) return false;
    return header
        .split(',')
        .some((tag) => tag.trim().replace(/^W\//, '') === etag);
}
