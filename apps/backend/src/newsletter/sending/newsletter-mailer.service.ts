import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import {
    NewsletterSettings,
    readNewsletterSettings,
} from '@/newsletter/newsletter-settings';

export interface NewsletterMail {
    to: string;
    toName?: string | null;
    subject: string;
    html: string;
    text: string;
    headers: Record<string, string>;
    /** Falls back to the configured newsletter Reply-To. */
    replyTo?: string | null;
}

export interface NewsletterSender {
    email: string;
    name: string;
}

/**
 * The bulk transport: `email.newsletter.smtp` when configured, else the main
 * SMTP settings. Separate from MailCoreService so a quota problem here never
 * blocks transactional mail, and so an unreachable server never fails boot.
 */
@Injectable()
export class NewsletterMailerService implements OnApplicationShutdown {
    private readonly logger = new Logger(NewsletterMailerService.name);
    private readonly settings: NewsletterSettings;
    // Created on the first send rather than at boot, and never verified: the
    // send loop reads a connection failure as a reason to pause, which is
    // the right outcome, whereas failing boot would take the whole API down
    // with the mail server.
    private transporter: Transporter | null = null;

    constructor(configService: ConfigService) {
        this.settings = readNewsletterSettings(configService);
    }

    /**
     * Rejects with the transport's error as-is, so the caller can read its
     * SMTP `responseCode` / `response` to tell throttling from a bounce.
     */
    async send(mail: NewsletterMail): Promise<void> {
        const replyTo = mail.replyTo || this.settings.replyTo;
        await this.getTransporter().sendMail({
            from: {
                name: this.settings.from.name,
                address: this.settings.from.email,
            },
            to: mail.toName ? { name: mail.toName, address: mail.to } : mail.to,
            replyTo: replyTo || undefined,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            headers: mail.headers,
        });
    }

    getFrom(): NewsletterSender {
        return { ...this.settings.from };
    }

    getDefaultReplyTo(): string | null {
        return this.settings.replyTo;
    }

    /** False when newsletters fall back to the transactional SMTP account. */
    usesDedicatedTransport(): boolean {
        return this.settings.dedicatedTransport;
    }

    onApplicationShutdown(): void {
        if (!this.transporter) return;
        try {
            this.transporter.close();
        } catch (error) {
            this.logger.error(
                `Error closing the newsletter transport: ${error.message}`,
                error.stack,
            );
        }
        this.transporter = null;
    }

    private getTransporter(): Transporter {
        if (!this.transporter) {
            const { host, port, secure, user, pass } = this.settings.smtp;
            this.transporter = createTransport({
                pool: true,
                // Sends are sequential and paced, and Gmail limits concurrent
                // connections per account.
                maxConnections: 1,
                host,
                port,
                secure,
                auth: user ? { user, pass: pass ?? '' } : undefined,
                // Bounded, so a hung server surfaces as ETIMEDOUT (which
                // pauses the send) well inside the stall-recovery window.
                connectionTimeout: 30_000,
                greetingTimeout: 30_000,
                socketTimeout: 60_000,
                tls: {
                    rejectUnauthorized: !['dev', 'test', 'e2e'].includes(
                        process.env.NODE_ENV || '',
                    ),
                },
            });
        }
        return this.transporter;
    }
}
