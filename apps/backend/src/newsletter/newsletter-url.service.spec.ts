import { ConfigService } from '@nestjs/config';
import { NewsletterUrlService } from '@/newsletter/newsletter-url.service';

describe('NewsletterUrlService', () => {
    const build = (baseUrl: string, frontEndUrl: string) =>
        new NewsletterUrlService({
            getOrThrow: (key: string) =>
                ({ 'app.baseUrl': baseUrl, 'app.frontEndUrl': frontEndUrl })[
                    key
                ],
        } as unknown as ConfigService);

    const urls = build('https://api.example.org/', 'https://app.example.org');

    it('builds the frontend pages', () => {
        expect(urls.subscribeUrl()).toBe(
            'https://app.example.org/newsletter/subscribe',
        );
        expect(urls.embedUrl()).toBe(
            'https://app.example.org/embed/newsletter',
        );
        expect(urls.confirmUrl('tok')).toBe(
            'https://app.example.org/newsletter/confirm?token=tok',
        );
        expect(urls.preferencesUrl('tok')).toBe(
            'https://app.example.org/newsletter/preferences?token=tok',
        );
        expect(urls.unsubscribeUrl('tok', 'nl-1')).toBe(
            'https://app.example.org/newsletter/unsubscribe?token=tok&n=nl-1',
        );
        expect(urls.unsubscribeUrl('tok')).toBe(
            'https://app.example.org/newsletter/unsubscribe?token=tok',
        );
    });

    it('builds the API endpoints', () => {
        expect(urls.oneClickUnsubscribeUrl('tok', 'nl-1')).toBe(
            'https://api.example.org/newsletter/public/unsubscribe/one-click?token=tok&n=nl-1',
        );
        expect(urls.openPixelUrl('d-1')).toBe(
            'https://api.example.org/newsletter/public/t/o/d-1.gif',
        );
        expect(urls.clickUrl('d-1', 3)).toBe(
            'https://api.example.org/newsletter/public/t/c/d-1/3',
        );
        expect(urls.imageUrl('img-1')).toBe(
            'https://api.example.org/newsletter/public/images/img-1',
        );
        expect(urls.publicSubscribeApiUrl()).toBe(
            'https://api.example.org/newsletter/public/subscribe',
        );
    });

    it('URL-encodes tokens', () => {
        expect(urls.confirmUrl('a+b/c=')).toBe(
            'https://app.example.org/newsletter/confirm?token=a%2Bb%2Fc%3D',
        );
    });

    it('keeps a path prefix on the base URLs', () => {
        const prefixed = build(
            'https://example.org/api',
            'https://example.org/app/',
        );
        expect(prefixed.openPixelUrl('d-1')).toBe(
            'https://example.org/api/newsletter/public/t/o/d-1.gif',
        );
        expect(prefixed.preferencesUrl('tok')).toBe(
            'https://example.org/app/newsletter/preferences?token=tok',
        );
    });
});
