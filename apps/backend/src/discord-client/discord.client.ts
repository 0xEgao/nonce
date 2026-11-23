import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { ServiceError } from '@/common/errors';
import { ConfigService } from '@nestjs/config';
import {
    DiscordTokenResponse,
    DiscordUser,
    GuildMember,
    GuildPartial,
} from '@/discord-client/response';

@Injectable()
export class DiscordClient {
    private readonly logger = new Logger(DiscordClient.name);
    private readonly axios: AxiosInstance;
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly callbackUrl: string;
    private readonly guildId: string;
    private readonly botToken: string;

    constructor(private readonly configService: ConfigService) {
        this.axios = axios.create({
            baseURL: this.configService.get<string>('discord.apiBaseUrl'),
        });
        this.clientId =
            this.configService.getOrThrow<string>('discord.clientId');
        this.clientSecret = this.configService.getOrThrow<string>(
            'discord.clientSecret',
        );
        this.callbackUrl = new URL(
            this.configService.getOrThrow<string>('app.auth.callbackPath'),
            this.configService.getOrThrow<string>('app.baseUrl'),
        ).toString();
        this.guildId = this.configService.getOrThrow<string>('discord.guildId');
        this.botToken =
            this.configService.getOrThrow<string>('discord.botToken');
    }

    // `expectedStatuses` are answers the caller handles (e.g. 404 for a user
    // not in the guild): still thrown, but not logged as a failure.
    private async executeRequest<T>(
        config: AxiosRequestConfig,
        attempt = 1,
        maxRetries = 3,
        expectedStatuses: number[] = [],
    ): Promise<T> {
        try {
            const response = await this.axios.request<T>(config);
            return response.data;
        } catch (error) {
            if (
                error instanceof AxiosError &&
                error.response?.status === 429 &&
                config.method?.toUpperCase() === 'GET' &&
                attempt < maxRetries
            ) {
                await new Promise((resolve) =>
                    setTimeout(resolve, 1000 * attempt),
                );
                return this.executeRequest<T>(
                    config,
                    attempt + 1,
                    maxRetries,
                    expectedStatuses,
                );
            }

            if (error instanceof AxiosError && error.response) {
                if (expectedStatuses.includes(error.response.status)) {
                    throw new ServiceError(
                        JSON.stringify(error.response.data),
                        { cause: error },
                    );
                }
                this.logger.error(
                    `Request to Discord failed!\nURL:\n${
                        config.url
                    }\nStatus code ${
                        error.response.status
                    }\nReason ${JSON.stringify(error.response.data)}`,
                );
                throw new ServiceError(JSON.stringify(error.response.data), {
                    cause: error,
                });
            }

            this.logger.error(error.message, error.stack);
            throw error;
        }
    }

    async exchangeCodeForTokens(code: string): Promise<DiscordTokenResponse> {
        const data = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.callbackUrl,
        });

        return await this.executeRequest<DiscordTokenResponse>({
            method: 'POST',
            url: '/oauth2/token',
            data,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            auth: {
                username: this.clientId,
                password: this.clientSecret,
            },
        });
    }

    async refreshTokens(refreshToken: string): Promise<DiscordTokenResponse> {
        const data = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
        });

        return await this.executeRequest<DiscordTokenResponse>({
            method: 'POST',
            url: '/oauth2/token',
            data,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            auth: {
                username: this.clientId,
                password: this.clientSecret,
            },
        });
    }

    async revokeToken(token: string): Promise<void> {
        const data = new URLSearchParams({
            token,
            token_type_hint: 'access_token',
        });

        return await this.executeRequest({
            method: 'POST',
            url: '/oauth2/token/revoke',
            data,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            auth: {
                username: this.clientId,
                password: this.clientSecret,
            },
        });
    }

    async fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
        return await this.executeRequest<DiscordUser>({
            method: 'GET',
            url: '/users/@me',
            headers: { Authorization: `Bearer ${accessToken}` },
        });
    }

    async listCurrentUserGuilds(accessToken: string): Promise<GuildPartial[]> {
        return await this.executeRequest<GuildPartial[]>({
            method: 'GET',
            url: '/users/@me/guilds',
            headers: { Authorization: `Bearer ${accessToken}` },
        });
    }

    async addUserToGuild(
        accessToken: string,
        discordUserId: string,
    ): Promise<void> {
        await this.executeRequest({
            method: 'PUT',
            url: `/guilds/${this.guildId}/members/${discordUserId}`,
            headers: {
                Authorization: `Bot ${this.botToken}`,
                'Content-Type': 'application/json',
            },
            data: {
                access_token: accessToken,
            },
        });
    }

    async getGuildMember(discordUserId: string): Promise<GuildMember> {
        return await this.executeRequest<GuildMember>({
            method: 'GET',
            url: `/guilds/${this.guildId}/members/${discordUserId}`,
            headers: {
                Authorization: `Bot ${this.botToken}`,
            },
        });
    }

    /**
     * The guild member, or null if the user is not in the guild. Unlike
     * getGuildMember, "not in the guild" is an answer here, not an error, so
     * the 404 is not logged: the daily fellow role sync looks up ex-fellows
     * who have left the server every day.
     */
    async findGuildMember(discordUserId: string): Promise<GuildMember | null> {
        try {
            return await this.executeRequest<GuildMember>(
                {
                    method: 'GET',
                    url: `/guilds/${this.guildId}/members/${discordUserId}`,
                    headers: {
                        Authorization: `Bot ${this.botToken}`,
                    },
                },
                1,
                3,
                [404],
            );
        } catch (error) {
            if (
                error.cause instanceof AxiosError &&
                error.cause.response?.status === 404
            ) {
                return null;
            }
            throw error;
        }
    }

    async removeRoleFromMember(
        discordUserId: string,
        roleId: string,
    ): Promise<void> {
        await this.executeRequest({
            method: 'DELETE',
            url: `/guilds/${this.guildId}/members/${discordUserId}/roles/${roleId}`,
            headers: {
                Authorization: `Bot ${this.botToken}`,
            },
        });
    }

    async attachRoleToMember(
        discordUserId: string,
        roleId: string,
    ): Promise<void> {
        await this.executeRequest({
            method: 'PUT',
            url: `/guilds/${this.guildId}/members/${discordUserId}/roles/${roleId}`,
            headers: {
                Authorization: `Bot ${this.botToken}`,
            },
        });
    }
}
