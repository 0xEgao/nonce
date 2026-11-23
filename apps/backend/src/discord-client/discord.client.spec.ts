import { ConfigService } from '@nestjs/config';
import { DiscordClient } from '@/discord-client/discord.client';

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
