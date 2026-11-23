import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosHeaders } from 'axios';
import { In, Repository } from 'typeorm';
import { FellowDiscordRolesService } from '@/fellowships/fellow-discord-roles.service';
import { Fellowship } from '@/entities/fellowship.entity';
import { DiscordClient } from '@/discord-client/discord.client';
import { GuildMember } from '@/discord-client/response';
import { FellowshipStatus, FellowshipType } from '@/common/enum';
import { ServiceError } from '@/common/errors';

const DEV_ROLE = '111';
const EDU_ROLE = '222';
const DESIGN_ROLE = '333';
const COHORT_ROLE = '999';

const NOW = new Date('2026-11-23T04:00:00Z');
const STARTED = new Date('2026-11-01T00:00:00Z');
const NOT_YET_STARTED = new Date('2026-12-01T00:00:00Z');

const ALL_ROLES: Record<string, string> = {
    'discord.roles.devFellow': DEV_ROLE,
    'discord.roles.eduFellow': EDU_ROLE,
    'discord.roles.designFellow': DESIGN_ROLE,
};

const active = (
    type: FellowshipType,
    discordUserId: string,
    startDate: Date | null = STARTED,
) =>
    ({
        type,
        status: FellowshipStatus.ACTIVE,
        startDate,
        user: { discordUserId },
    }) as Fellowship;

const completed = (type: FellowshipType, discordUserId: string) =>
    ({
        type,
        status: FellowshipStatus.COMPLETED,
        startDate: STARTED,
        user: { discordUserId },
    }) as Fellowship;

// What DiscordClient throws for a 404: a ServiceError wrapping the AxiosError.
const unknownMember = () =>
    new ServiceError('{"message":"Unknown Member","code":10007}', {
        cause: new AxiosError(
            'Request failed with status code 404',
            'ERR_BAD_REQUEST',
            undefined,
            undefined,
            {
                status: 404,
                statusText: 'Not Found',
                data: {},
                headers: {},
                config: { headers: new AxiosHeaders() },
            },
        ),
    });

describe('FellowDiscordRolesService.syncFellowRoles', () => {
    let fellowshipRepository: { find: jest.Mock };
    let discordClient: {
        getGuildMember: jest.Mock;
        attachRoleToMember: jest.Mock;
        removeRoleFromMember: jest.Mock;
    };
    // Discord user id -> roles they hold. Absent means not in the guild.
    let guild: Record<string, string[]>;

    const build = (roles: Record<string, string> = ALL_ROLES) =>
        new FellowDiscordRolesService(
            fellowshipRepository as unknown as Repository<Fellowship>,
            discordClient as unknown as DiscordClient,
            { get: (key: string) => roles[key] } as unknown as ConfigService,
        );

    beforeEach(() => {
        guild = {};
        fellowshipRepository = { find: jest.fn().mockResolvedValue([]) };
        discordClient = {
            getGuildMember: jest.fn(
                async (id: string): Promise<GuildMember> => {
                    if (!guild[id]) throw unknownMember();
                    return { user: { id, username: id }, roles: guild[id] };
                },
            ),
            attachRoleToMember: jest.fn().mockResolvedValue(undefined),
            removeRoleFromMember: jest.fn().mockResolvedValue(undefined),
        };
    });

    it('reads ACTIVE and COMPLETED fellowships only', async () => {
        await build().syncFellowRoles(NOW);

        expect(fellowshipRepository.find).toHaveBeenCalledWith({
            where: {
                status: In([
                    FellowshipStatus.ACTIVE,
                    FellowshipStatus.COMPLETED,
                ]),
            },
            relations: { user: true },
        });
    });

    it('grants each started fellow the role for their fellowship type', async () => {
        fellowshipRepository.find.mockResolvedValue([
            active(FellowshipType.DEVELOPER, 'dev'),
            active(FellowshipType.EDUCATOR, 'edu'),
            active(FellowshipType.DESIGNER, 'design'),
        ]);
        guild = { dev: [], edu: [COHORT_ROLE], design: [] };

        const result = await build().syncFellowRoles(NOW);

        expect(discordClient.attachRoleToMember.mock.calls).toEqual([
            ['dev', DEV_ROLE],
            ['edu', EDU_ROLE],
            ['design', DESIGN_ROLE],
        ]);
        expect(discordClient.removeRoleFromMember).not.toHaveBeenCalled();
        expect(result).toEqual({
            granted: 3,
            removed: 0,
            failed: 0,
            notInGuild: 0,
        });
    });

    it('does not grant before the contract start date', async () => {
        fellowshipRepository.find.mockResolvedValue([
            active(FellowshipType.DEVELOPER, 'future', NOT_YET_STARTED),
            active(FellowshipType.DEVELOPER, 'no-date', null),
        ]);
        guild = { future: [], 'no-date': [] };

        const result = await build().syncFellowRoles(NOW);

        expect(discordClient.attachRoleToMember).not.toHaveBeenCalled();
        expect(result.granted).toBe(0);
    });

    it('grants on the start date itself', async () => {
        fellowshipRepository.find.mockResolvedValue([
            active(FellowshipType.DEVELOPER, 'today', NOW),
        ]);
        guild = { today: [] };

        await build().syncFellowRoles(NOW);

        expect(discordClient.attachRoleToMember).toHaveBeenCalledWith(
            'today',
            DEV_ROLE,
        );
    });

    it('does not re-grant a role the fellow already holds', async () => {
        fellowshipRepository.find.mockResolvedValue([
            active(FellowshipType.DEVELOPER, 'dev'),
        ]);
        guild = { dev: [DEV_ROLE] };

        const result = await build().syncFellowRoles(NOW);

        expect(discordClient.attachRoleToMember).not.toHaveBeenCalled();
        expect(result.granted).toBe(0);
    });

    it('removes the role when the fellowship of that type has ended', async () => {
        fellowshipRepository.find.mockResolvedValue([
            completed(FellowshipType.DEVELOPER, 'ex'),
        ]);
        guild = { ex: [DEV_ROLE, COHORT_ROLE] };

        const result = await build().syncFellowRoles(NOW);

        expect(discordClient.removeRoleFromMember.mock.calls).toEqual([
            ['ex', DEV_ROLE],
        ]);
        expect(result.removed).toBe(1);
    });

    it('never looks up anyone without a fellowship, so hand-granted roles stay', async () => {
        guild = { 'pre-app-fellow': [DEV_ROLE, EDU_ROLE] };

        await build().syncFellowRoles(NOW);

        expect(discordClient.getGuildMember).not.toHaveBeenCalled();
        expect(discordClient.removeRoleFromMember).not.toHaveBeenCalled();
    });

    it('leaves a fellow role of another type alone, even if granted by hand', async () => {
        fellowshipRepository.find.mockResolvedValue([
            active(FellowshipType.DEVELOPER, 'dev'),
            completed(FellowshipType.EDUCATOR, 'ex-edu'),
        ]);
        guild = {
            dev: [DEV_ROLE, DESIGN_ROLE],
            'ex-edu': [EDU_ROLE, DEV_ROLE],
        };

        await build().syncFellowRoles(NOW);

        expect(discordClient.removeRoleFromMember.mock.calls).toEqual([
            ['ex-edu', EDU_ROLE],
        ]);
    });

    it('keeps the role of a returning fellow whose new contract has not started yet', async () => {
        fellowshipRepository.find.mockResolvedValue([
            completed(FellowshipType.DEVELOPER, 'returning'),
            active(FellowshipType.DEVELOPER, 'returning', NOT_YET_STARTED),
        ]);
        guild = { returning: [DEV_ROLE] };

        const result = await build().syncFellowRoles(NOW);

        expect(discordClient.removeRoleFromMember).not.toHaveBeenCalled();
        expect(discordClient.attachRoleToMember).not.toHaveBeenCalled();
        expect(result).toEqual({
            granted: 0,
            removed: 0,
            failed: 0,
            notInGuild: 0,
        });
    });

    it('leaves an unconfigured role alone', async () => {
        fellowshipRepository.find.mockResolvedValue([
            active(FellowshipType.DESIGNER, 'design'),
            completed(FellowshipType.DEVELOPER, 'ex-dev'),
        ]);
        guild = { design: [], 'ex-dev': [DEV_ROLE] };

        const result = await build({
            'discord.roles.designFellow': DESIGN_ROLE,
        }).syncFellowRoles(NOW);

        // Designer set: granted. Developer unset: ex-dev not even looked up.
        expect(discordClient.attachRoleToMember.mock.calls).toEqual([
            ['design', DESIGN_ROLE],
        ]);
        expect(discordClient.getGuildMember).toHaveBeenCalledTimes(1);
        expect(discordClient.removeRoleFromMember).not.toHaveBeenCalled();
        expect(result.granted).toBe(1);
    });

    it('does nothing, not even reading the database, when no fellow role is configured', async () => {
        const result = await build({}).syncFellowRoles(NOW);

        expect(fellowshipRepository.find).not.toHaveBeenCalled();
        expect(discordClient.getGuildMember).not.toHaveBeenCalled();
        expect(result).toEqual({
            granted: 0,
            removed: 0,
            failed: 0,
            notInGuild: 0,
        });
    });

    it('counts started fellows who are not in the guild, but not ex-fellows', async () => {
        fellowshipRepository.find.mockResolvedValue([
            active(FellowshipType.DEVELOPER, 'gone'),
            active(FellowshipType.EDUCATOR, 'gone'),
            completed(FellowshipType.DESIGNER, 'ex-gone'),
        ]);

        const result = await build().syncFellowRoles(NOW);

        expect(discordClient.getGuildMember).toHaveBeenCalledTimes(2);
        expect(result).toEqual({
            granted: 0,
            removed: 0,
            failed: 0,
            notInGuild: 1,
        });
    });

    it('keeps going past failed lookups and changes, and counts them', async () => {
        fellowshipRepository.find.mockResolvedValue([
            active(FellowshipType.DEVELOPER, 'lookup-fails'),
            active(FellowshipType.DEVELOPER, 'grant-fails'),
            active(FellowshipType.DEVELOPER, 'ok'),
        ]);
        guild = { 'grant-fails': [], ok: [] };
        discordClient.getGuildMember.mockImplementationOnce(async () => {
            throw new ServiceError('rate limited');
        });
        discordClient.attachRoleToMember
            .mockRejectedValueOnce(new Error('Missing Permissions'))
            .mockResolvedValueOnce(undefined);

        const result = await build().syncFellowRoles(NOW);

        expect(discordClient.attachRoleToMember.mock.calls).toEqual([
            ['grant-fails', DEV_ROLE],
            ['ok', DEV_ROLE],
        ]);
        expect(result).toEqual({
            granted: 1,
            removed: 0,
            failed: 2,
            notInGuild: 0,
        });
    });
});
