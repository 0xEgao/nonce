import { ConfigService } from '@nestjs/config';
import { FindManyOptions, LessThanOrEqual, Repository } from 'typeorm';
import { FellowDiscordRolesService } from '@/fellowships/fellow-discord-roles.service';
import { Fellowship } from '@/entities/fellowship.entity';
import { DiscordClient } from '@/discord-client/discord.client';
import { FellowshipStatus, FellowshipType } from '@/common/enum';

const ROLES: Record<string, string> = {
    'discord.roles.devFellow': 'dev-role',
    'discord.roles.eduFellow': 'edu-role',
    'discord.roles.designFellow': 'design-role',
};

const NOW = new Date('2026-11-24T04:00:00Z');

const fellowship = (id: string, type: FellowshipType) =>
    ({
        id,
        type,
        user: { id: `user-${id}`, discordUserId: `discord-${id}` },
    }) as Fellowship;

describe('FellowDiscordRolesService.syncFellowRoles', () => {
    // What the two queries return: fellowships due a role, and completed
    // fellowships whose role is still assigned.
    let toGrant: Fellowship[];
    let toRemove: Fellowship[];
    let fellowshipRepository: {
        find: jest.Mock;
        existsBy: jest.Mock;
        update: jest.Mock;
    };
    let discordClient: {
        attachRoleToMember: jest.Mock;
        removeRoleFromMember: jest.Mock;
    };
    let service: FellowDiscordRolesService;

    beforeEach(() => {
        toGrant = [];
        toRemove = [];
        fellowshipRepository = {
            find: jest.fn(async (options: FindManyOptions<Fellowship>) =>
                (options.where as { status: FellowshipStatus }).status ===
                FellowshipStatus.ACTIVE
                    ? toGrant
                    : toRemove,
            ),
            existsBy: jest.fn().mockResolvedValue(false),
            update: jest.fn().mockResolvedValue(undefined),
        };
        discordClient = {
            attachRoleToMember: jest.fn().mockResolvedValue(undefined),
            removeRoleFromMember: jest.fn().mockResolvedValue(undefined),
        };
        service = new FellowDiscordRolesService(
            fellowshipRepository as unknown as Repository<Fellowship>,
            discordClient as unknown as DiscordClient,
            {
                getOrThrow: (key: string) => ROLES[key],
            } as unknown as ConfigService,
        );
    });

    it('looks for started ACTIVE fellowships without the role, and COMPLETED ones with it', async () => {
        await service.syncFellowRoles(NOW);

        expect(fellowshipRepository.find.mock.calls).toEqual([
            [
                {
                    where: {
                        status: FellowshipStatus.ACTIVE,
                        startDate: LessThanOrEqual(NOW),
                        discordRoleAssigned: false,
                    },
                    relations: { user: true },
                },
            ],
            [
                {
                    where: {
                        status: FellowshipStatus.COMPLETED,
                        discordRoleAssigned: true,
                    },
                    relations: { user: true },
                },
            ],
        ]);
    });

    it('calls Discord for nobody when no fellowship is due a change', async () => {
        await service.syncFellowRoles(NOW);

        expect(discordClient.attachRoleToMember).not.toHaveBeenCalled();
        expect(discordClient.removeRoleFromMember).not.toHaveBeenCalled();
        expect(fellowshipRepository.update).not.toHaveBeenCalled();
    });

    it('grants the role for the fellowship type and records it', async () => {
        toGrant = [
            fellowship('dev', FellowshipType.DEVELOPER),
            fellowship('edu', FellowshipType.EDUCATOR),
            fellowship('design', FellowshipType.DESIGNER),
        ];

        await service.syncFellowRoles(NOW);

        expect(discordClient.attachRoleToMember.mock.calls).toEqual([
            ['discord-dev', 'dev-role'],
            ['discord-edu', 'edu-role'],
            ['discord-design', 'design-role'],
        ]);
        expect(fellowshipRepository.update.mock.calls).toEqual([
            ['dev', { discordRoleAssigned: true }],
            ['edu', { discordRoleAssigned: true }],
            ['design', { discordRoleAssigned: true }],
        ]);
    });

    it('leaves a failed grant unrecorded, so the next run retries it, and carries on', async () => {
        toGrant = [
            fellowship('fails', FellowshipType.DEVELOPER),
            fellowship('ok', FellowshipType.DEVELOPER),
        ];
        discordClient.attachRoleToMember.mockRejectedValueOnce(
            new Error('Unknown Member'),
        );

        await service.syncFellowRoles(NOW);

        expect(fellowshipRepository.update.mock.calls).toEqual([
            ['ok', { discordRoleAssigned: true }],
        ]);
    });

    it('removes the role of a completed fellowship and records it', async () => {
        toRemove = [fellowship('ex', FellowshipType.EDUCATOR)];

        await service.syncFellowRoles(NOW);

        expect(fellowshipRepository.existsBy).toHaveBeenCalledWith({
            user: { id: 'user-ex' },
            type: FellowshipType.EDUCATOR,
            status: FellowshipStatus.ACTIVE,
        });
        expect(discordClient.removeRoleFromMember.mock.calls).toEqual([
            ['discord-ex', 'edu-role'],
        ]);
        expect(fellowshipRepository.update.mock.calls).toEqual([
            ['ex', { discordRoleAssigned: false }],
        ]);
    });

    it('keeps the role of someone with another ACTIVE fellowship of that type', async () => {
        toRemove = [fellowship('renewed', FellowshipType.DEVELOPER)];
        fellowshipRepository.existsBy.mockResolvedValue(true);

        await service.syncFellowRoles(NOW);

        expect(discordClient.removeRoleFromMember).not.toHaveBeenCalled();
        // The completed fellowship lets go of the role; the active one now
        // decides when it is removed.
        expect(fellowshipRepository.update.mock.calls).toEqual([
            ['renewed', { discordRoleAssigned: false }],
        ]);
    });

    it('leaves a failed removal recorded as assigned, so the next run retries it, and carries on', async () => {
        toRemove = [
            fellowship('fails', FellowshipType.DESIGNER),
            fellowship('ok', FellowshipType.DESIGNER),
        ];
        discordClient.removeRoleFromMember.mockRejectedValueOnce(
            new Error('Missing Permissions'),
        );

        await service.syncFellowRoles(NOW);

        expect(fellowshipRepository.update.mock.calls).toEqual([
            ['ok', { discordRoleAssigned: false }],
        ]);
    });
});
