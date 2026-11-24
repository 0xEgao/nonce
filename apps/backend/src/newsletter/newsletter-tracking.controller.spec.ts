import { INestApplication, Logger } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { IS_PUBLIC_KEY } from '@/auth/public-route.decorator';
import { NewsletterTrackingController } from '@/newsletter/newsletter-tracking.controller';
import { NewsletterTrackingService } from '@/newsletter/newsletter-tracking.service';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';

const DELIVERY_ID = '9b1f3c52-2f3e-4b0e-8a57-6d2c1e4f7a90';
const FRONTEND_URL = 'https://app.example.com';

// Parses a response body into a Buffer instead of letting supertest guess.
const asBuffer = (
    res: request.Response,
    callback: (error: Error | null, body: Buffer) => void,
) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('NewsletterTrackingController', () => {
    let app: INestApplication;

    const service = {
        recordOpen: jest.fn(),
        recordClick: jest.fn(),
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
        service.recordOpen.mockResolvedValue(undefined);
        service.recordClick.mockResolvedValue(null);

        const module = await Test.createTestingModule({
            imports: [
                // Two requests a minute per client; the tracking routes must
                // sail past it, because a mail proxy sends thousands.
                ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }]),
            ],
            controllers: [NewsletterTrackingController],
            providers: [
                { provide: NewsletterTrackingService, useValue: service },
                {
                    provide: NewsletterUrlService,
                    useValue: { getFrontendUrl: () => FRONTEND_URL },
                },
                { provide: APP_GUARD, useClass: ThrottlerGuard },
            ],
        }).compile();

        app = module.createNestApplication();
        await app.init();
    });

    afterEach(async () => {
        await app.close();
        jest.restoreAllMocks();
    });

    describe('GET /newsletter/public/t/o/:deliveryId.gif', () => {
        const pixel = (id: string = DELIVERY_ID) =>
            request(app.getHttpServer())
                .get(`/newsletter/public/t/o/${id}.gif`)
                .buffer(true)
                .parse(asBuffer);

        const expectTransparentGif = (response: request.Response) => {
            const body = response.body as Buffer;
            expect(response.headers['content-type']).toBe('image/gif');
            expect(response.headers['cache-control']).toBe('no-store, private');
            expect(body.subarray(0, 6).toString('latin1')).toBe('GIF89a');
            // Logical screen: 1 pixel wide, 1 pixel high.
            expect(body.readUInt16LE(6)).toBe(1);
            expect(body.readUInt16LE(8)).toBe(1);
            expect(body[body.length - 1]).toBe(0x3b);
            expect(response.headers['content-length']).toBe(
                String(body.length),
            );
        };

        it('matches a .gif path on Express 5 and records the open for that delivery', async () => {
            const response = await pixel().expect(200);

            expectTransparentGif(response);
            expect(service.recordOpen).toHaveBeenCalledTimes(1);
            expect(service.recordOpen).toHaveBeenCalledWith(DELIVERY_ID);
        });

        it('still answers with the gif when the service throws', async () => {
            service.recordOpen.mockRejectedValue(new Error('db is on fire'));

            const response = await pixel().expect(200);

            expectTransparentGif(response);
            expect(Logger.prototype.warn).toHaveBeenCalledWith(
                expect.stringContaining('db is on fire'),
            );
        });

        it('still answers with the gif for a bad or unknown id', async () => {
            for (const id of ['not-a-uuid', '12345', 'a'.repeat(300)]) {
                expectTransparentGif(await pixel(id).expect(200));
            }
            expect(service.recordOpen).toHaveBeenCalledTimes(3);
        });

        it('does not match a path without the .gif suffix', async () => {
            await request(app.getHttpServer())
                .get(`/newsletter/public/t/o/${DELIVERY_ID}`)
                .expect(404);
            expect(service.recordOpen).not.toHaveBeenCalled();
        });

        it('is public and never throttled', async () => {
            expect(
                Reflect.getMetadata(
                    IS_PUBLIC_KEY,
                    NewsletterTrackingController,
                ),
            ).toBe(true);
            expect(
                Reflect.getMetadata(
                    'THROTTLER:SKIPdefault',
                    NewsletterTrackingController,
                ),
            ).toBe(true);

            for (let i = 0; i < 6; i++) {
                await pixel().expect(200);
            }
            expect(service.recordOpen).toHaveBeenCalledTimes(6);
        });
    });

    describe('GET /newsletter/public/t/c/:deliveryId/:linkIndex', () => {
        const click = (path: string) =>
            request(app.getHttpServer()).get(`/newsletter/public/t/c/${path}`);

        it('redirects with a 302 to the stored link and records the click', async () => {
            service.recordClick.mockResolvedValue(
                'https://dest.example/page?a=1&b=2',
            );

            const response = await click(`${DELIVERY_ID}/3`).expect(302);

            expect(response.headers.location).toBe(
                'https://dest.example/page?a=1&b=2',
            );
            expect(response.headers['cache-control']).toBe('no-store, private');
            expect(service.recordClick).toHaveBeenCalledWith(DELIVERY_ID, 3);
        });

        it('redirects to the frontend for an unknown delivery or index', async () => {
            service.recordClick.mockResolvedValue(null);

            const response = await click(`${DELIVERY_ID}/99`).expect(302);

            expect(response.headers.location).toBe(FRONTEND_URL);
            expect(response.headers['cache-control']).toBe('no-store, private');
        });

        it.each([
            ['abc'],
            ['-1'],
            ['1.5'],
            ['1e1'],
            ['0x1'],
            ['%201'],
            ['1%20'],
            ['99999999999999999999'],
        ])(
            'redirects to the frontend for the index %j without asking the service',
            async (index) => {
                const response = await click(`${DELIVERY_ID}/${index}`).expect(
                    302,
                );

                expect(response.headers.location).toBe(FRONTEND_URL);
                expect(service.recordClick).not.toHaveBeenCalled();
            },
        );

        it('redirects to the frontend for a malformed delivery id', async () => {
            const response = await click('not-a-uuid/0').expect(302);

            expect(response.headers.location).toBe(FRONTEND_URL);
        });

        it('can not be used as an open redirect', async () => {
            service.recordClick.mockResolvedValue(null);

            for (const path of [
                `${DELIVERY_ID}/0?url=https://evil.example`,
                `${DELIVERY_ID}/0?redirect=//evil.example&to=https://evil.example`,
                `${DELIVERY_ID}/https%3A%2F%2Fevil.example`,
                `https%3A%2F%2Fevil.example/0`,
                `${DELIVERY_ID}/0#https://evil.example`,
            ]) {
                const response = await click(path).expect(302);
                expect(response.headers.location).toBe(FRONTEND_URL);
            }
            // The service only ever receives a string id and an integer index.
            for (const [id, index] of service.recordClick.mock.calls) {
                expect(typeof id).toBe('string');
                expect(Number.isInteger(index)).toBe(true);
            }
        });

        it('errors, rather than guessing a destination, when the lookup fails', async () => {
            jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
            service.recordClick.mockRejectedValue(new Error('db down'));

            await click(`${DELIVERY_ID}/0`).expect(500);
        });

        it('is never throttled', async () => {
            service.recordClick.mockResolvedValue('https://dest.example/');

            for (let i = 0; i < 6; i++) {
                await click(`${DELIVERY_ID}/0`).expect(302);
            }
            expect(service.recordClick).toHaveBeenCalledTimes(6);
        });
    });
});
