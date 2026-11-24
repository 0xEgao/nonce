import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosHeaders } from 'axios';
import { DiscordClient } from '@/discord-client/discord.client';
import { ServiceError } from '@/common/errors';

const config = {
    get: jest.fn().mockReturnValue('https://discord.example/api'),
    getOrThrow: jest.fn((key: string) =>
        key === 'app.baseUrl'
            ? 'http://localhost:3000'
            : key === 'app.auth.callbackPath'
              ? '/auth/discord/callback'
              : key === 'discord.guildId'
                ? 'guild-1'
                : 'secret',
    ),
} as unknown as ConfigService;

// A failed Discord response: the HTTP status plus Discord's JSON error code.
const discordError = (status: number, code: number) =>
    new AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_REQUEST',
        undefined,
        undefined,
        {
            status,
            statusText: '',
            data: { message: 'Discord error', code },
            headers: {},
            config: { headers: new AxiosHeaders() },
        },
    );

describe('DiscordClient.removeRoleFromMember', () => {
    let client: DiscordClient;
    let request: jest.SpyInstance;

    beforeEach(() => {
        client = new DiscordClient(config);
        request = jest.spyOn((client as any).axios, 'request');
        jest.spyOn((client as any).logger, 'error').mockImplementation(
            () => undefined,
        );
    });

    afterEach(() => jest.restoreAllMocks());

    it('sends a bot-authenticated DELETE for the member role', async () => {
        request.mockResolvedValueOnce({ data: undefined });

        await client.removeRoleFromMember('user-1', 'role-1');

        expect(request).toHaveBeenCalledWith({
            method: 'DELETE',
            url: '/guilds/guild-1/members/user-1/roles/role-1',
            headers: { Authorization: 'Bot secret' },
        });
    });

    it('counts a user who has left the guild as removed', async () => {
        request.mockRejectedValueOnce(discordError(404, 10007));

        await expect(
            client.removeRoleFromMember('gone', 'role-1'),
        ).resolves.toBeUndefined();
    });

    it('throws on any other failure, including a role that does not exist', async () => {
        request
            .mockRejectedValueOnce(discordError(404, 10011))
            .mockRejectedValueOnce(discordError(403, 50013));

        await expect(
            client.removeRoleFromMember('user-1', 'no-such-role'),
        ).rejects.toBeInstanceOf(ServiceError);
        await expect(
            client.removeRoleFromMember('user-1', 'role-1'),
        ).rejects.toBeInstanceOf(ServiceError);
    });
});
