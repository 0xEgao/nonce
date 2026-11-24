import {
    BadRequestException,
    Injectable,
    NotFoundException,
    PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { NewsletterImageResponse } from '@nonce/shared';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { NewsletterImage } from '@/entities/newsletter-image.entity';
import { User } from '@/entities/user.entity';
import {
    NEWSLETTER_IMAGE_CACHE_MAX_BYTES,
    NEWSLETTER_IMAGE_MAX_BYTES,
} from '@/newsletter/newsletter.constants';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';

const FILE_NAME_MAX_LENGTH = 255;

/**
 * The image type `buffer` really is, from its leading bytes, or null. The
 * type the client declared is never trusted, and SVG is deliberately not
 * recognised: it can carry script, and most mail clients will not render it.
 */
export function detectImageMimeType(buffer: Buffer): string | null {
    if (
        buffer.length >= 8 &&
        buffer
            .subarray(0, 8)
            .equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            )
    ) {
        return 'image/png';
    }
    if (
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff
    ) {
        return 'image/jpeg';
    }
    if (buffer.length >= 6) {
        const signature = buffer.subarray(0, 6).toString('latin1');
        if (signature === 'GIF87a' || signature === 'GIF89a') {
            return 'image/gif';
        }
    }
    // RIFF, a 4-byte size, then WEBP (other RIFF files, such as WAV, differ
    // only in this last tag).
    if (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
        buffer.subarray(8, 12).toString('latin1') === 'WEBP'
    ) {
        return 'image/webp';
    }
    return null;
}

@Injectable()
export class NewsletterImagesService {
    // Least recently served first (a Map iterates in insertion order). An
    // image's bytes never change under its id, so an entry never goes stale.
    private readonly cache = new Map<string, NewsletterImage>();
    private cachedBytes = 0;

    constructor(
        @InjectRepository(NewsletterImage)
        private readonly imageRepository: Repository<NewsletterImage>,
        private readonly urlService: NewsletterUrlService,
    ) {}

    /** png/jpeg/gif/webp up to NEWSLETTER_IMAGE_MAX_BYTES. */
    async upload(
        file: Express.Multer.File,
        user: User,
    ): Promise<NewsletterImageResponse> {
        // `@UploadedFile()` is undefined when the `file` field is missing.
        if (!file?.buffer) {
            throw new BadRequestException(
                'Attach an image as the multipart field "file"',
            );
        }
        // The upload interceptor enforces this while streaming; checked again
        // so the limit holds for any caller of the service.
        if (file.buffer.length > NEWSLETTER_IMAGE_MAX_BYTES) {
            throw new PayloadTooLargeException(
                `Images can be at most ${NEWSLETTER_IMAGE_MAX_BYTES / (1024 * 1024)} MB`,
            );
        }
        const mimeType = detectImageMimeType(file.buffer);
        if (!mimeType) {
            throw new BadRequestException(
                'Only PNG, JPEG, GIF or WebP images are allowed',
            );
        }

        const image = await this.imageRepository.save(
            this.imageRepository.create({
                mimeType,
                data: file.buffer,
                sizeBytes: file.buffer.length,
                fileName: sanitizeFileName(file.originalname),
                uploadedBy: user,
            }),
        );
        return { id: image.id, url: this.urlService.imageUrl(image.id) };
    }

    /**
     * With `data` loaded, from memory when it was served recently.
     * NotFoundException when unknown.
     */
    async getImage(id: string): Promise<NewsletterImage> {
        // Postgres rejects a malformed uuid with an error, which would surface
        // as a 500 for what is just an unknown image.
        if (!isUUID(id)) throw new NotFoundException('Image not found');

        const cached = this.cache.get(id);
        if (cached) {
            // Re-inserted, it becomes the most recently served.
            this.cache.delete(id);
            this.cache.set(id, cached);
            return cached;
        }

        // `data` is `select: false`, so it has to be asked for.
        const image = await this.imageRepository
            .createQueryBuilder('image')
            .addSelect('image.data')
            .where('image.id = :id', { id })
            .getOne();
        if (!image) throw new NotFoundException('Image not found');
        this.remember(image);
        return image;
    }

    private remember(image: NewsletterImage): void {
        // Two requests for the same image can both miss and both load it.
        if (this.cache.has(image.id)) return;
        this.cache.set(image.id, image);
        this.cachedBytes += image.data.length;
        for (const [id, entry] of this.cache) {
            if (this.cachedBytes <= NEWSLETTER_IMAGE_CACHE_MAX_BYTES) break;
            this.cache.delete(id);
            this.cachedBytes -= entry.data.length;
        }
    }
}

// Only kept to tell uploads apart in the database; never used in a path or a
// header, but still bounded and stripped of control characters.
function sanitizeFileName(name: string | undefined): string | null {
    const cleaned = (name ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, FILE_NAME_MAX_LENGTH);
    return cleaned || null;
}
