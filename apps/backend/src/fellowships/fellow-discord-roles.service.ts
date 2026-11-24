import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Fellowship } from '@/entities/fellowship.entity';
import { FellowshipStatus, FellowshipType } from '@/common/enum';
import { DiscordClient } from '@/discord-client/discord.client';
import { GuildMember } from '@/discord-client/response';

const FELLOW_ROLE_CONFIG_KEYS: Record<FellowshipType, string> = {
    [FellowshipType.DEVELOPER]: 'discord.roles.devFellow',
    [FellowshipType.EDUCATOR]: 'discord.roles.eduFellow',
    [FellowshipType.DESIGNER]: 'discord.roles.designFellow',
};

export interface FellowRoleSyncResult {
    granted: number;
    removed: number;
    failed: number;
    // Fellows due a role whom the bot could not find in the guild.
    notInGuild: number;
}

// Per Discord user: the fellow roles to hold, to drop, and to leave alone.
interface RolePlan {
    grant: Set<string>;
    revoke: Set<string>;
    keep: Set<string>;
}

/**
 * Keeps the Discord fellow roles (dev-fellow, edu-fellows, design-fellow) in
 * step with fellowships in the app:
 *
 * - Grant: an ACTIVE fellowship whose contract startDate has passed gets the
 *   role for its type. Not on accept, and not when an admin starts a contract
 *   dated in the future: the role starts when the contract does.
 * - Remove: only from someone whose fellowship of that type has ended in the
 *   app (COMPLETED) and who has no ACTIVE one of that type.
 *
 * Nobody else is touched. Roles granted by hand (e.g. fellows from before the
 * app) stay, because the app has no fellowship that says they should go. The
 * sync therefore only looks up the app's own fellows, never the whole guild.
 *
 * Desired state is recomputed from scratch on every run, so a failed change is
 * retried by the next run; nothing is persisted.
 */
@Injectable()
export class FellowDiscordRolesService {
    private readonly logger = new Logger(FellowDiscordRolesService.name);
    private readonly roleIdByType: Record<FellowshipType, string>;

    constructor(
        @InjectRepository(Fellowship)
        private readonly fellowshipRepository: Repository<Fellowship>,
        private readonly discordClient: DiscordClient,
        configService: ConfigService,
    ) {
        const roleId = (type: FellowshipType) =>
            configService.getOrThrow<string>(FELLOW_ROLE_CONFIG_KEYS[type]);
        this.roleIdByType = {
            [FellowshipType.DEVELOPER]: roleId(FellowshipType.DEVELOPER),
            [FellowshipType.EDUCATOR]: roleId(FellowshipType.EDUCATOR),
            [FellowshipType.DESIGNER]: roleId(FellowshipType.DESIGNER),
        };
    }

    async syncFellowRoles(
        now: Date = new Date(),
    ): Promise<FellowRoleSyncResult> {
        const result: FellowRoleSyncResult = {
            granted: 0,
            removed: 0,
            failed: 0,
            notInGuild: 0,
        };

        const plans = await this.planRoles(now);

        for (const [discordUserId, plan] of plans) {
            let member: GuildMember | null;
            try {
                member =
                    await this.discordClient.findGuildMember(discordUserId);
            } catch (error) {
                result.failed++;
                this.logger.warn(
                    `Failed to read Discord member ${discordUserId} for fellow role sync: ${error?.message}`,
                );
                continue;
            }
            if (!member) {
                // An ex-fellow who left the guild has nothing to remove.
                if (plan.grant.size > 0) result.notInGuild++;
                continue;
            }
            const { roles } = member;

            for (const roleId of plan.grant) {
                if (roles.includes(roleId)) continue;
                await this.change('grant', discordUserId, roleId, result);
            }
            for (const roleId of plan.revoke) {
                if (!roles.includes(roleId) || plan.keep.has(roleId)) continue;
                await this.change('remove', discordUserId, roleId, result);
            }
        }

        return result;
    }

    private async planRoles(now: Date): Promise<Map<string, RolePlan>> {
        const fellowships = await this.fellowshipRepository.find({
            where: {
                status: In([
                    FellowshipStatus.ACTIVE,
                    FellowshipStatus.COMPLETED,
                ]),
            },
            relations: { user: true },
        });

        const plans = new Map<string, RolePlan>();
        for (const fellowship of fellowships) {
            const roleId = this.roleIdByType[fellowship.type];

            const discordUserId = fellowship.user.discordUserId;
            let plan = plans.get(discordUserId);
            if (!plan) {
                plan = { grant: new Set(), revoke: new Set(), keep: new Set() };
                plans.set(discordUserId, plan);
            }

            if (fellowship.status === FellowshipStatus.COMPLETED) {
                plan.revoke.add(roleId);
                continue;
            }
            // ACTIVE. A contract dated in the future does not grant yet, but
            // it does protect the role from an earlier COMPLETED fellowship
            // of the same type, so a returning fellow is not dropped in between.
            plan.keep.add(roleId);
            if (fellowship.startDate && fellowship.startDate <= now) {
                plan.grant.add(roleId);
            }
        }
        return plans;
    }

    // Each change is logged by user and role: the log is the record of who
    // the sync granted or removed, and so the way to undo a bad run.
    private async change(
        action: 'grant' | 'remove',
        discordUserId: string,
        roleId: string,
        result: FellowRoleSyncResult,
    ): Promise<void> {
        try {
            if (action === 'grant') {
                await this.discordClient.attachRoleToMember(
                    discordUserId,
                    roleId,
                );
                result.granted++;
            } else {
                await this.discordClient.removeRoleFromMember(
                    discordUserId,
                    roleId,
                );
                result.removed++;
            }
            this.logger.log(
                `Fellow role ${roleId} ${action === 'grant' ? 'granted to' : 'removed from'} Discord user ${discordUserId}`,
            );
        } catch (error) {
            result.failed++;
            this.logger.warn(
                `Failed to ${action} fellow role ${roleId} for Discord user ${discordUserId}: ${error?.message}`,
            );
        }
    }
}
