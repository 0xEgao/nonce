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

const axiosError = (status: number) =>
    new AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_REQUEST',
        undefined,
        undefined,
        {
            status,
            statusText: '',
            data: { message: 'Unknown Member', code: 10007 },
            headers: {},
            config: { headers: new AxiosHeaders() },
        },
    );

describe('DiscordClient.findGuildMember', () => {
    afterEach(() => jest.restoreAllMocks());

    it('returns the member when they are in the guild', async () => {
        const client = new DiscordClient(config);
        const member = { user: { id: 'u1', username: 'u1' }, roles: ['r1'] };
        jest.spyOn((client as any).axios, 'request').mockResolvedValueOnce({
            data: member,
        });

        await expect(client.findGuildMember('u1')).resolves.toEqual(member);
    });

    it('returns null without logging an error when the user is not in the guild', async () => {
        const client = new DiscordClient(config);
        jest.spyOn((client as any).axios, 'request').mockRejectedValueOnce(
            axiosError(404),
        );
        const logError = jest.spyOn((client as any).logger, 'error');

        await expect(client.findGuildMember('gone')).resolves.toBeNull();
        expect(logError).not.toHaveBeenCalled();
    });

    it('still logs and throws on any other failure', async () => {
        const client = new DiscordClient(config);
        jest.spyOn((client as any).axios, 'request').mockRejectedValueOnce(
            axiosError(403),
        );
        const logError = jest
            .spyOn((client as any).logger, 'error')
            .mockImplementation(() => undefined);

        await expect(client.findGuildMember('u1')).rejects.toBeInstanceOf(
            ServiceError,
        );
        expect(logError).toHaveBeenCalledTimes(1);
    });
});

describe('DiscordClient.removeRoleFromMember', () => {
    it('sends a bot-authenticated DELETE for the member role', async () => {
        const client = new DiscordClient(config);
        const request = jest
            .spyOn(client as any, 'executeRequest')
            .mockResolvedValueOnce(undefined);

        await client.removeRoleFromMember('user-1', 'role-1');

        expect(request).toHaveBeenCalledWith({
            method: 'DELETE',
            url: '/guilds/guild-1/members/user-1/roles/role-1',
            headers: { Authorization: 'Bot secret' },
        });
    });
});
