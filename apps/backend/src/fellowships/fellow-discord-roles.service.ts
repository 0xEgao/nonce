import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Fellowship } from '@/entities/fellowship.entity';
import { FellowshipStatus, FellowshipType } from '@/common/enum';
import { DiscordClient } from '@/discord-client/discord.client';

/**
 * Gives a fellow the Discord role for their fellowship type (dev-fellow,
 * edu-fellows, design-fellow) once the contract has started, and takes it back
 * once the fellowship is COMPLETED.
 *
 * fellowship.discordRoleAssigned records that the app granted the role. So
 * each fellowship is granted once and removed once, and a role the app did not
 * grant is never removed. A failed Discord call leaves the flag as it was, and
 * the next daily run tries again.
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
        this.roleIdByType = {
            [FellowshipType.DEVELOPER]: configService.getOrThrow<string>(
                'discord.roles.devFellow',
            ),
            [FellowshipType.EDUCATOR]: configService.getOrThrow<string>(
                'discord.roles.eduFellow',
            ),
            [FellowshipType.DESIGNER]: configService.getOrThrow<string>(
                'discord.roles.designFellow',
            ),
        };
    }

    async syncFellowRoles(now: Date = new Date()): Promise<void> {
        await this.grantRolesForStartedFellowships(now);
        await this.removeRolesForCompletedFellowships();
    }

    private async grantRolesForStartedFellowships(now: Date): Promise<void> {
        const fellowships = await this.fellowshipRepository.find({
            where: {
                status: FellowshipStatus.ACTIVE,
                startDate: LessThanOrEqual(now),
                discordRoleAssigned: false,
            },
            relations: { user: true },
        });

        for (const fellowship of fellowships) {
            const roleId = this.roleIdByType[fellowship.type];
            const { discordUserId } = fellowship.user;
            try {
                await this.discordClient.attachRoleToMember(
                    discordUserId,
                    roleId,
                );
                await this.fellowshipRepository.update(fellowship.id, {
                    discordRoleAssigned: true,
                });
                this.logger.log(
                    `Fellow role ${roleId} granted to Discord user ${discordUserId}`,
                );
            } catch (error) {
                this.logger.warn(
                    `Failed to grant fellow role ${roleId} to Discord user ${discordUserId}: ${error?.message}`,
                );
            }
        }
    }

    private async removeRolesForCompletedFellowships(): Promise<void> {
        const fellowships = await this.fellowshipRepository.find({
            where: {
                status: FellowshipStatus.COMPLETED,
                discordRoleAssigned: true,
            },
            relations: { user: true },
        });

        for (const fellowship of fellowships) {
            const roleId = this.roleIdByType[fellowship.type];
            const { discordUserId } = fellowship.user;
            try {
                // Someone with another running fellowship of this type is
                // still a fellow: they keep the role, and that fellowship
                // removes it when it completes.
                const isStillFellow = await this.fellowshipRepository.existsBy({
                    user: { id: fellowship.user.id },
                    type: fellowship.type,
                    status: FellowshipStatus.ACTIVE,
                });
                if (!isStillFellow) {
                    await this.discordClient.removeRoleFromMember(
                        discordUserId,
                        roleId,
                    );
                    this.logger.log(
                        `Fellow role ${roleId} removed from Discord user ${discordUserId}`,
                    );
                }
                await this.fellowshipRepository.update(fellowship.id, {
                    discordRoleAssigned: false,
                });
            } catch (error) {
                this.logger.warn(
                    `Failed to remove fellow role ${roleId} from Discord user ${discordUserId}: ${error?.message}`,
                );
            }
        }
    }
}
