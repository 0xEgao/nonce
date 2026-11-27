import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
    BadRequestException,
    NotFoundException,
    PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    detectImageMimeType,
    NewsletterImagesService,
} from '@/newsletter/images/newsletter-images.service';
import { randomUUID } from 'crypto';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';
import {
    NEWSLETTER_IMAGE_CACHE_MAX_BYTES,
    NEWSLETTER_IMAGE_MAX_BYTES,
} from '@/newsletter/newsletter.constants';
import { NewsletterImage } from '@/entities/newsletter-image.entity';
import { User } from '@/entities/user.entity';

const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF87 = Buffer.from('GIF87a\x01\x00\x01\x00', 'latin1');
const GIF89 = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const WEBP = Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBPVP8 ', 'latin1'),
]);

const IMAGE_ID = '3f2b1c9e-7d4a-4e8b-9a61-0c5d2e7f8a10';

describe('detectImageMimeType', () => {
    it.each([
        ['PNG', PNG, 'image/png'],
        ['JPEG', JPEG, 'image/jpeg'],
        ['GIF87a', GIF87, 'image/gif'],
        ['GIF89a', GIF89, 'image/gif'],
        ['WebP', WEBP, 'image/webp'],
    ])('recognises %s', (_name, buffer, expected) => {
        expect(detectImageMimeType(buffer)).toBe(expected);
    });

    it('rejects a text file that was renamed to .png', () => {
        expect(
            detectImageMimeType(Buffer.from('just some notes\n')),
        ).toBeNull();
    });

    it('rejects html, a pdf and an executable', () => {
        expect(
            detectImageMimeType(Buffer.from('<html><script>x()</script>')),
        ).toBeNull();
        expect(detectImageMimeType(Buffer.from('%PDF-1.7 ...'))).toBeNull();
        expect(
            detectImageMimeType(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])),
        ).toBeNull();
    });

    it('rejects SVG, with or without an xml prolog', () => {
        expect(
            detectImageMimeType(
                Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
            ),
        ).toBeNull();
        expect(
            detectImageMimeType(
                Buffer.from(
                    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>',
                ),
            ),
        ).toBeNull();
    });

    it('rejects other RIFF containers such as WAV', () => {
        const wav = Buffer.concat([
            Buffer.from('RIFF', 'latin1'),
            Buffer.from([0x24, 0x00, 0x00, 0x00]),
            Buffer.from('WAVEfmt ', 'latin1'),
        ]);
        expect(detectImageMimeType(wav)).toBeNull();
    });

    it('rejects an empty or truncated file', () => {
        expect(detectImageMimeType(Buffer.alloc(0))).toBeNull();
        expect(detectImageMimeType(PNG.subarray(0, 4))).toBeNull();
        expect(detectImageMimeType(JPEG.subarray(0, 2))).toBeNull();
        expect(detectImageMimeType(GIF89.subarray(0, 5))).toBeNull();
        expect(detectImageMimeType(WEBP.subarray(0, 11))).toBeNull();
    });

    it('does not accept a signature that is not at the very start', () => {
        expect(
            detectImageMimeType(Buffer.concat([Buffer.from(' '), PNG])),
        ).toBeNull();
    });
});

describe('NewsletterImagesService', () => {
    let service: NewsletterImagesService;

    const queryBuilder = {
        addSelect: jest.fn(),
        where: jest.fn(),
        getOne: jest.fn(),
    };
    const imageRepository = {
        create: jest.fn((entity: Partial<NewsletterImage>) => entity),
        save: jest.fn(),
        createQueryBuilder: jest.fn(),
    };

    const admin = { id: 'user-1' } as User;

    const multerFile = (
        buffer: Buffer,
        overrides: Partial<Express.Multer.File> = {},
    ) =>
        ({
            buffer,
            size: buffer.length,
            originalname: 'photo.png',
            mimetype: 'image/png',
            ...overrides,
        }) as Express.Multer.File;

    beforeEach(async () => {
        jest.clearAllMocks();
        queryBuilder.addSelect.mockReturnValue(queryBuilder);
        queryBuilder.where.mockReturnValue(queryBuilder);
        imageRepository.createQueryBuilder.mockReturnValue(queryBuilder);
        imageRepository.save.mockImplementation(
            async (entity: Partial<NewsletterImage>) => ({
                ...entity,
                id: IMAGE_ID,
            }),
        );

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                NewsletterImagesService,
                NewsletterUrlService,
                {
                    provide: ConfigService,
                    useValue: {
                        getOrThrow: (key: string) =>
                            key === 'app.baseUrl'
                                ? 'https://api.example.com/'
                                : 'https://app.example.com',
                    },
                },
                {
                    provide: getRepositoryToken(NewsletterImage),
                    useValue: imageRepository,
                },
            ],
        }).compile();

        service = module.get(NewsletterImagesService);
    });

    describe('upload', () => {
        it.each([
            ['image/png', PNG],
            ['image/jpeg', JPEG],
            ['image/gif', GIF89],
            ['image/webp', WEBP],
        ])('stores a %s and returns its public url', async (mime, buffer) => {
            const result = await service.upload(multerFile(buffer), admin);

            expect(result).toEqual({
                id: IMAGE_ID,
                url: `https://api.example.com/newsletter/public/images/${IMAGE_ID}`,
            });
            expect(imageRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    mimeType: mime,
                    data: buffer,
                    sizeBytes: buffer.length,
                    fileName: 'photo.png',
                    uploadedBy: admin,
                }),
            );
        });

        it('stores the type detected from the bytes, not the declared one', async () => {
            await service.upload(
                multerFile(JPEG, {
                    mimetype: 'image/png',
                    originalname: 'actually-a-jpeg.png',
                }),
                admin,
            );

            expect(imageRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({ mimeType: 'image/jpeg' }),
            );
        });

        it('rejects a renamed non-image that declares an image type', async () => {
            const file = multerFile(Buffer.from('#!/bin/sh\nrm -rf /\n'), {
                originalname: 'cat.png',
                mimetype: 'image/png',
            });

            await expect(service.upload(file, admin)).rejects.toThrow(
                BadRequestException,
            );
            expect(imageRepository.save).not.toHaveBeenCalled();
        });

        it('rejects an SVG even when it declares image/png', async () => {
            const svg = Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            );

            await expect(
                service.upload(
                    multerFile(svg, { originalname: 'logo.svg' }),
                    admin,
                ),
            ).rejects.toThrow(BadRequestException);
            expect(imageRepository.save).not.toHaveBeenCalled();
        });

        it('rejects an oversized file', async () => {
            const tooBig = Buffer.concat([
                PNG,
                Buffer.alloc(NEWSLETTER_IMAGE_MAX_BYTES),
            ]);

            await expect(
                service.upload(multerFile(tooBig), admin),
            ).rejects.toThrow(PayloadTooLargeException);
            expect(imageRepository.save).not.toHaveBeenCalled();
        });

        it('accepts a file of exactly the size limit', async () => {
            const exact = Buffer.concat([
                PNG,
                Buffer.alloc(NEWSLETTER_IMAGE_MAX_BYTES - PNG.length),
            ]);

            await expect(
                service.upload(multerFile(exact), admin),
            ).resolves.toEqual(expect.objectContaining({ id: IMAGE_ID }));
        });

        it('rejects a request without a file', async () => {
            await expect(
                service.upload(
                    undefined as unknown as Express.Multer.File,
                    admin,
                ),
            ).rejects.toThrow(BadRequestException);
            expect(imageRepository.save).not.toHaveBeenCalled();
        });

        it('cleans and bounds the stored file name', async () => {
            await service.upload(
                multerFile(PNG, {
                    originalname: `a\r\nb\u0000${'x'.repeat(400)}.png`,
                }),
                admin,
            );

            const saved = imageRepository.save.mock
                .calls[0][0] as NewsletterImage;
            expect(saved.fileName).toHaveLength(255);
            expect(saved.fileName).toMatch(/^abx+$/);
        });

        it('stores no file name when there is none', async () => {
            await service.upload(
                multerFile(PNG, { originalname: '  ' }),
                admin,
            );

            expect(imageRepository.save).toHaveBeenCalledWith(
                expect.objectContaining({ fileName: null }),
            );
        });
    });

    describe('getImage', () => {
        it('loads the image with its data column', async () => {
            const image = { id: IMAGE_ID, mimeType: 'image/png', data: PNG };
            queryBuilder.getOne.mockResolvedValue(image);

            await expect(service.getImage(IMAGE_ID)).resolves.toBe(image);
            // `data` is select:false, so it has to be selected explicitly.
            expect(queryBuilder.addSelect).toHaveBeenCalledWith('image.data');
            expect(queryBuilder.where).toHaveBeenCalledWith('image.id = :id', {
                id: IMAGE_ID,
            });
        });

        it('throws NotFoundException for an unknown id', async () => {
            queryBuilder.getOne.mockResolvedValue(null);

            await expect(service.getImage(IMAGE_ID)).rejects.toThrow(
                NotFoundException,
            );
        });

        it.each(['not-a-uuid', '', '1', "' OR 1=1 --", '../../etc/passwd'])(
            'throws NotFoundException for the malformed id %j without querying',
            async (id) => {
                await expect(service.getImage(id)).rejects.toThrow(
                    NotFoundException,
                );
                expect(
                    imageRepository.createQueryBuilder,
                ).not.toHaveBeenCalled();
            },
        );

        describe('in-memory cache', () => {
            // Each a maximum-size image; the cache holds this many of them.
            const FULL = Buffer.alloc(NEWSLETTER_IMAGE_MAX_BYTES);
            const fits =
                NEWSLETTER_IMAGE_CACHE_MAX_BYTES / NEWSLETTER_IMAGE_MAX_BYTES;
            const ids = Array.from({ length: fits + 1 }, () => randomUUID());

            beforeEach(() => {
                queryBuilder.where.mockImplementation(
                    (_sql: string, { id }: { id: string }) => {
                        queryBuilder.getOne.mockResolvedValueOnce({
                            id,
                            mimeType: 'image/png',
                            data: FULL,
                        });
                        return queryBuilder;
                    },
                );
            });

            const loads = () => queryBuilder.getOne.mock.calls.length;

            it('serves a repeat request from memory', async () => {
                const first = await service.getImage(IMAGE_ID);
                const second = await service.getImage(IMAGE_ID);

                expect(second).toBe(first);
                expect(loads()).toBe(1);
            });

            it('does not remember an unknown image', async () => {
                queryBuilder.where.mockReturnValue(queryBuilder);
                queryBuilder.getOne.mockResolvedValue(null);

                await expect(service.getImage(IMAGE_ID)).rejects.toThrow(
                    NotFoundException,
                );
                await expect(service.getImage(IMAGE_ID)).rejects.toThrow(
                    NotFoundException,
                );
                expect(loads()).toBe(2);
            });

            it('drops the least recently served image once over its byte budget', async () => {
                for (const id of ids.slice(0, fits)) await service.getImage(id);
                expect(loads()).toBe(fits);

                // Served again, the oldest is now the most recent.
                await service.getImage(ids[0]);
                expect(loads()).toBe(fits);

                // One more than fits: the least recently served goes.
                await service.getImage(ids[fits]);
                await service.getImage(ids[0]);
                expect(loads()).toBe(fits + 1);
                await service.getImage(ids[1]);
                expect(loads()).toBe(fits + 2);
            });
        });
    });
});
