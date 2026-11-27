import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ResponseLoggingInterceptor } from '@/interceptors/response-logger.interceptor';

interface FakeRequest {
    method: string;
    route: { path: string };
    query: object;
    params: object;
    body: unknown;
}

/** What the interceptor logs for `req` answered with `data`. */
async function logged(req: FakeRequest, data: unknown): Promise<string> {
    const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
    const context = {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of(data) };

    await lastValueFrom(
        new ResponseLoggingInterceptor().intercept(context, next),
    );
    expect(log).toHaveBeenCalledTimes(1);
    return log.mock.calls[0][0] as string;
}

describe('ResponseLoggingInterceptor', () => {
    afterEach(() => jest.restoreAllMocks());

    it('logs every other route exactly as before, whatever its keys', async () => {
        const req = {
            method: 'POST',
            route: { path: '/assignments/:id/submissions' },
            query: { token: 'q-token' },
            params: { id: 'a-1' },
            body: { content: 'print(1)', text: 'note' },
        };
        const data = { content: 'stdout', html: '<p>x</p>', token: 't' };

        expect(await logged(req, data)).toBe(
            JSON.stringify(
                {
                    request: {
                        message: 'POST',
                        path: '/assignments/:id/submissions',
                        query: req.query,
                        params: req.params,
                        body: req.body,
                    },
                    response: { body: data },
                },
                null,
                2,
            ),
        );
    });

    it('never logs a subscriber token on a newsletter route', async () => {
        const output = await logged(
            {
                method: 'PUT',
                route: { path: '/newsletter/public/preferences' },
                query: { token: 'secret-query-token' },
                params: {},
                body: {
                    token: 'secret-body-token',
                    subscribedListIds: ['l-1'],
                },
            },
            { email: 'a@x.test', status: 'ACTIVE', lists: [] },
        );

        expect(output).not.toContain('secret-');
        expect(JSON.parse(output)).toEqual({
            request: {
                message: 'PUT',
                path: '/newsletter/public/preferences',
                query: { token: '[redacted]' },
                params: {},
                body: { token: '[redacted]', subscribedListIds: ['l-1'] },
            },
            response: {
                body: { email: 'a@x.test', status: 'ACTIVE', lists: [] },
            },
        });
    });

    it('logs only the length of newsletter bodies and previews, at any depth', async () => {
        const content = 'x'.repeat(500_000);
        const output = await logged(
            {
                method: 'POST',
                route: { path: '/newsletter/admin/newsletters/:id/preview' },
                query: {},
                params: { id: 'nl-1' },
                body: { subject: 'Hello', content, preheader: null },
            },
            {
                subject: 'Hello',
                html: '<p>hi</p>',
                text: 'hi',
                nested: { records: [{ content: 'abc' }] },
            },
        );

        expect(output.length).toBeLessThan(1000);
        const { request, response } = JSON.parse(output);
        expect(request.body).toEqual({
            subject: 'Hello',
            content: '[500000 chars]',
            preheader: null,
        });
        expect(response.body).toEqual({
            subject: 'Hello',
            html: '[9 chars]',
            text: '[2 chars]',
            nested: { records: [{ content: '[3 chars]' }] },
        });
    });
});
