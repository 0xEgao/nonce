import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Every link a newsletter, a confirmation email or the admin UI hands out.
 * Pages a person lands on live on the frontend; machine endpoints (one-click
 * unsubscribe, tracking, images) on the API. Tokens and ids are always
 * URL-encoded.
 */
@Injectable()
export class NewsletterUrlService {
    private readonly apiBaseUrl: string;
    private readonly frontendUrl: string;

    constructor(configService: ConfigService) {
        this.apiBaseUrl = withoutTrailingSlash(
            configService.getOrThrow<string>('app.baseUrl'),
        );
        this.frontendUrl = withoutTrailingSlash(
            configService.getOrThrow<string>('app.frontEndUrl'),
        );
    }

    getApiBaseUrl(): string {
        return this.apiBaseUrl;
    }

    getFrontendUrl(): string {
        return this.frontendUrl;
    }

    // --- Frontend pages ---

    subscribeUrl(): string {
        return `${this.frontendUrl}/newsletter/subscribe`;
    }

    /** The chromeless subscribe form, for an iframe on bitshala.org. */
    embedUrl(): string {
        return `${this.frontendUrl}/embed/newsletter`;
    }

    confirmUrl(token: string): string {
        return this.frontend('/newsletter/confirm', { token });
    }

    /**
     * The unsubscribe page. Unsubscribing never happens on the GET itself
     * (link scanners follow every link), so the page confirms with a POST.
     */
    unsubscribeUrl(token: string, newsletterId?: string): string {
        return this.frontend('/newsletter/unsubscribe', {
            token,
            n: newsletterId,
        });
    }

    preferencesUrl(token: string): string {
        return this.frontend('/newsletter/preferences', { token });
    }

    // --- API endpoints ---

    /** RFC 8058 target for the List-Unsubscribe header; mail clients POST it. */
    oneClickUnsubscribeUrl(token: string, newsletterId: string): string {
        return this.api('/newsletter/public/unsubscribe/one-click', {
            token,
            n: newsletterId,
        });
    }

    openPixelUrl(deliveryId: string): string {
        return `${this.apiBaseUrl}/newsletter/public/t/o/${encodeURIComponent(deliveryId)}.gif`;
    }

    clickUrl(deliveryId: string, linkIndex: number): string {
        return `${this.apiBaseUrl}/newsletter/public/t/c/${encodeURIComponent(deliveryId)}/${linkIndex}`;
    }

    imageUrl(imageId: string): string {
        return `${this.apiBaseUrl}/newsletter/public/images/${encodeURIComponent(imageId)}`;
    }

    /** For the copy-paste embed snippet. */
    publicSubscribeApiUrl(): string {
        return `${this.apiBaseUrl}/newsletter/public/subscribe`;
    }

    publicListsApiUrl(): string {
        return `${this.apiBaseUrl}/newsletter/public/lists`;
    }

    private frontend(
        path: string,
        query: Record<string, string | undefined>,
    ): string {
        return `${this.frontendUrl}${path}${toQueryString(query)}`;
    }

    private api(
        path: string,
        query: Record<string, string | undefined>,
    ): string {
        return `${this.apiBaseUrl}${path}${toQueryString(query)}`;
    }
}

// Joined as strings rather than with `new URL(path, base)`, which would drop
// any path prefix the base URL carries.
function withoutTrailingSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

function toQueryString(query: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, value);
    }
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
}
