import { INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { IS_PUBLIC_KEY } from '@/auth/public-route.decorator';
import { ROLES_KEY } from '@/auth/roles.decorator';
import { RolesGuard } from '@/auth/roles.guard';
import { UserRole } from '@/common/enum';
import { NewsletterImagesController } from '@/newsletter/images/newsletter-images.controller';
import { NewsletterImagesService } from '@/newsletter/images/newsletter-images.service';
import { NEWSLETTER_IMAGE_MAX_BYTES } from '@/newsletter/newsletter.constants';

const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const IMAGE_ID = '3f2b1c9e-7d4a-4e8b-9a61-0c5d2e7f8a10';

describe('NewsletterImagesController', () => {
    let app: INestApplication;
    let currentUser: { id: string; role: UserRole } | undefined;

    const service = {
        upload: jest.fn(),
        getImage: jest.fn(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        currentUser = { id: 'admin-1', role: UserRole.ADMIN };

        const module = await Test.createTestingModule({
            imports: [
                // Two requests a minute per client: anything that is not
                // exempt is throttled on its third call.
                ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }]),
            ],
            controllers: [NewsletterImagesController],
            providers: [
                { provide: NewsletterImagesService, useValue: service },
                { provide: APP_GUARD, useClass: ThrottlerGuard },
                // Stands in for AuthGuard + RolesGuard: `currentUser` is what
                // the JWT would have put on the request.
                { provide: APP_GUARD, useClass: RolesGuard },
            ],
        }).compile();

        app = module.createNestApplication();
        app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
            req.user = currentUser;
            next();
        });
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    describe('POST /newsletter/admin/images', () => {
        const upload = (
            buffer: Buffer,
            options: { filename?: string; contentType?: string } = {},
        ) =>
            request(app.getHttpServer())
                .post('/newsletter/admin/images')
                .attach('file', buffer, {
                    filename: options.filename ?? 'photo.png',
                    contentType: options.contentType ?? 'image/png',
                });

        it('hands the uploaded file and the user to the service', async () => {
            service.upload.mockResolvedValue({
                id: IMAGE_ID,
                url: `https://api.example.com/newsletter/public/images/${IMAGE_ID}`,
            });

            const response = await upload(PNG).expect(201);

            expect(response.body).toEqual({
                id: IMAGE_ID,
                url: `https://api.example.com/newsletter/public/images/${IMAGE_ID}`,
            });
            const [file, user] = service.upload.mock.calls[0];
            expect(Buffer.from(file.buffer).equals(PNG)).toBe(true);
            expect(file.originalname).toBe('photo.png');
            expect(user).toBe(currentUser);
        });

        it('is for admins only', async () => {
            currentUser = { id: 'student-1', role: UserRole.STUDENT };

            await upload(PNG).expect(403);

            currentUser = { id: 'ta-1', role: UserRole.TEACHING_ASSISTANT };
            await upload(PNG).expect(403);

            expect(service.upload).not.toHaveBeenCalled();
        });

        it('carries @Roles(ADMIN) on the route itself', () => {
            // The class has no guard decorators, and RolesGuard lets any
            // signed-in user through a route without roles.
            expect(
                Reflect.getMetadata(
                    ROLES_KEY,
                    NewsletterImagesController.prototype.uploadImage,
                ),
            ).toEqual([UserRole.ADMIN]);
            expect(
                Reflect.getMetadata(ROLES_KEY, NewsletterImagesController),
            ).toBeUndefined();
        });

        it('rejects a declared type that is not an allowed image type', async () => {
            const response = await upload(Buffer.from('<svg></svg>'), {
                filename: 'logo.svg',
                contentType: 'image/svg+xml',
            }).expect(400);

            expect(response.body.message).toMatch(/PNG, JPEG, GIF or WebP/);
            expect(service.upload).not.toHaveBeenCalled();
        });

        it('rejects a file over the size limit with 413', async () => {
            const tooBig = Buffer.concat([
                PNG,
                Buffer.alloc(NEWSLETTER_IMAGE_MAX_BYTES),
            ]);

            await upload(tooBig).expect(413);
            expect(service.upload).not.toHaveBeenCalled();
        });

        it('passes an undefined file to the service when none was sent', async () => {
            service.upload.mockResolvedValue({ id: IMAGE_ID, url: 'u' });

            await request(app.getHttpServer())
                .post('/newsletter/admin/images')
                .field('note', 'no file here')
                .expect(201);

            expect(service.upload.mock.calls[0][0]).toBeUndefined();
        });
    });

    describe('GET /newsletter/public/images/:id', () => {
        const image = { id: IMAGE_ID, mimeType: 'image/png', data: PNG };

        beforeEach(() => {
            // Anyone, including mail-client proxies without a login.
            currentUser = undefined;
            service.getImage.mockResolvedValue(image);
        });

        it('streams the bytes with the stored type and permanent caching headers', async () => {
            const response = await request(app.getHttpServer())
                .get(`/newsletter/public/images/${IMAGE_ID}`)
                .buffer(true)
                .parse((res, callback) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => chunks.push(chunk));
                    res.on('end', () => callback(null, Buffer.concat(chunks)));
                })
                .expect(200);

            expect(service.getImage).toHaveBeenCalledWith(IMAGE_ID);
            expect(response.headers['content-type']).toBe('image/png');
            expect(response.headers['cache-control']).toBe(
                'public, max-age=31536000, immutable',
            );
            expect(response.headers['x-content-type-options']).toBe('nosniff');
            expect(response.headers['content-length']).toBe(String(PNG.length));
            expect(response.headers.etag).toBe(`"${IMAGE_ID}"`);
            expect((response.body as Buffer).equals(PNG)).toBe(true);
        });

        it.each([
            `"${IMAGE_ID}"`,
            `W/"${IMAGE_ID}"`,
            `"something-else", W/"${IMAGE_ID}"`,
        ])(
            'answers If-None-Match: %s with 304 without loading the image',
            async (ifNoneMatch) => {
                const response = await request(app.getHttpServer())
                    .get(`/newsletter/public/images/${IMAGE_ID}`)
                    .set('If-None-Match', ifNoneMatch)
                    .expect(304);

                expect(service.getImage).not.toHaveBeenCalled();
                expect(response.headers.etag).toBe(`"${IMAGE_ID}"`);
                expect(response.headers['cache-control']).toBe(
                    'public, max-age=31536000, immutable',
                );
                expect(response.text ?? '').toBe('');
            },
        );

        it.each(['"something-else"', '*'])(
            'serves the image for If-None-Match: %s',
            async (ifNoneMatch) => {
                await request(app.getHttpServer())
                    .get(`/newsletter/public/images/${IMAGE_ID}`)
                    .set('If-None-Match', ifNoneMatch)
                    .expect(200);

                expect(service.getImage).toHaveBeenCalledWith(IMAGE_ID);
            },
        );

        it('answers an unknown image with 404, and nothing a cache would keep', async () => {
            service.getImage.mockRejectedValue(new NotFoundException());

            const response = await request(app.getHttpServer())
                .get(`/newsletter/public/images/${IMAGE_ID}`)
                .expect(404);

            expect(response.headers['cache-control']).toBeUndefined();
            // Express tags every JSON body itself; just not with the image's.
            expect(response.headers.etag).not.toBe(`"${IMAGE_ID}"`);
        });

        it('does not answer a malformed id with 304', async () => {
            service.getImage.mockRejectedValue(new NotFoundException());

            await request(app.getHttpServer())
                .get('/newsletter/public/images/not-a-uuid')
                .set('If-None-Match', '"not-a-uuid"')
                .expect(404);
        });

        it('is public and exempt from throttling', async () => {
            const handler = NewsletterImagesController.prototype.getImage;
            expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
            expect(Reflect.getMetadata('THROTTLER:SKIPdefault', handler)).toBe(
                true,
            );

            // The throttler above allows two requests a minute.
            for (let i = 0; i < 6; i++) {
                await request(app.getHttpServer())
                    .get(`/newsletter/public/images/${IMAGE_ID}`)
                    .expect(200);
            }
        });

        it('keeps the admin upload throttled, so the exemption is only for the image', async () => {
            service.upload.mockResolvedValue({ id: IMAGE_ID, url: 'u' });
            const upload = () =>
                request(app.getHttpServer())
                    .post('/newsletter/admin/images')
                    .attach('file', PNG, {
                        filename: 'a.png',
                        contentType: 'image/png',
                    });
            currentUser = { id: 'admin-1', role: UserRole.ADMIN };

            await upload().expect(201);
            await upload().expect(201);
            await upload().expect(429);
        });
    });
});
