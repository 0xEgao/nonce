import {
    CallHandler,
    ExecutionContext,
    Injectable,
    Logger,
    NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { defaultIfEmpty, tap } from 'rxjs/operators';

// Newsletter routes carry subscriber tokens (they never rotate, and grant
// preference management) and whole newsletter bodies of up to hundreds of
// KB, sent again on every autosave and preview. Neither belongs in the log.
const REDACTED_ROUTE = /^\/newsletter(\/|$)/;
const REDACTED_KEYS = new Set(['token', 'content', 'html', 'text']);

/**
 * A `JSON.stringify` replacer for newsletter routes: the value of any
 * REDACTED_KEYS key, at any depth, becomes a placeholder. It runs inside the
 * serialisation the log does anyway, so nothing is copied.
 */
function redactNewsletterFields(key: string, value: unknown): unknown {
    if (!REDACTED_KEYS.has(key) || value === null || value === undefined) {
        return value;
    }
    if (key !== 'token' && typeof value === 'string') {
        return `[${value.length} chars]`;
    }
    return '[redacted]';
}

@Injectable()
export class ResponseLoggingInterceptor implements NestInterceptor {
    private logger = new Logger(ResponseLoggingInterceptor.name);

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        if (context.getType() !== 'http') {
            return next.handle();
        }

        const requestContext = context.switchToHttp().getRequest();

        const query = requestContext.query;
        const params = requestContext.params;
        const requestBody = requestContext.body;

        return next.handle().pipe(
            tap((data) => {
                if (data?.stream) {
                    data = 'response is a data stream, not logging it';
                }

                const request = {
                    message: requestContext.method,
                    path: requestContext.route.path,
                    query: query,
                    params: params,
                    body: requestBody,
                };
                const response = { body: data };
                const replacer = REDACTED_ROUTE.test(request.path)
                    ? redactNewsletterFields
                    : undefined;

                this.logger.log(
                    JSON.stringify(
                        {
                            request,
                            response,
                        },
                        replacer,
                        2,
                    ),
                );
            }),

            defaultIfEmpty(null),
        );
    }
}
