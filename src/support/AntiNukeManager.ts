import { GuildAuditLogsEntry, GuildMember, PartialGuildMember, Message, AuditLogEvent, Snowflake, User, PartialUser, GuildTextBasedChannel, Guild, EmbedBuilder } from "discord.js";
import { Role } from "discord.js";
import { AnyThreadChannel } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { GuildConfigs } from "../config/GuildConfigs.js";

export class AntiNukeManager {

    private guildHolder: GuildHolder;
    private restrictedActionLog: number[] = [];
    private actionLimit = 15; // max actions every minute

    constructor(guildHolder: GuildHolder) {
        this.guildHolder = guildHolder;
    }

    getSelfID(): Snowflake {
        return this.guildHolder.getBot().client?.user?.id || '';
    }

    getGuild(): Guild {
        return this.guildHolder.getGuild();
    }

    async getLogChannel(): Promise<GuildTextBasedChannel | null> {
        const id = this.guildHolder.getConfigManager().getConfig(GuildConfigs.LOGS_CHANNEL_ID);
        if (!id) {
            return null;
        }
        const channel = await this.guildHolder.getGuild().channels.fetch(id).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            return null;
        }
        return channel;
    }

    async isPermittedExecutor(executor: User | PartialUser): Promise<boolean> {
        const selfId = this.getSelfID();
        if (!selfId) {
            return false;
        }

        // check if executor is self
        if (executor.id === this.getSelfID()) {
            return true;
        }

        if (this.guildHolder.getGuild().ownerId === executor.id) {
            return true;
        }

        const selfMember = await this.guildHolder.getGuild().members.fetch(selfId);
        if (!selfMember) {
            return false;
        }

        const executorMember = await this.guildHolder.getGuild().members.fetch(executor.id).catch(() => null);

        if (!executorMember) {
            return false;
        }

        if (executorMember.roles.highest.position <= selfMember.roles.highest.position) {
            return false;
        }

        return true;
    }

    async handleAuditLogEntry(entry: GuildAuditLogsEntry) {
        const actionsList = [
            AuditLogEvent.IntegrationCreate,
            AuditLogEvent.MemberBanAdd,
            AuditLogEvent.MemberKick,
        ]

        if (!actionsList.includes(entry.action)) {
            return;
        }

        if (!entry ||!entry.executor || await this.isPermittedExecutor(entry.executor)) {
            return;
        }


        if (entry.action === AuditLogEvent.IntegrationCreate) {
            const botID = (entry as GuildAuditLogsEntry<AuditLogEvent.IntegrationCreate>).target.account.id;
            const botMember = await this.guildHolder.getGuild().members.fetch(botID).catch(() => null);

            if (!botMember) {
                return;
            }

            await botMember.kick('Anti-Nuke: Unauthorized bot integration added').catch(() => null);

            const logChannel = await this.getLogChannel();
            if (logChannel) {
                const embed = new EmbedBuilder()
                    .setTitle('Anti-Nuke: Unauthorized Bot Integration Removed')
                    .setDescription(`A bot integration was added by an unauthorized user and has been removed.`)
                    .addFields(
                        { name: 'Executor', value: `${entry.executor.tag} (${entry.executor.id})`, inline: true },
                        { name: 'Bot', value: `${botMember.user.tag} (${botMember.user.id})`, inline: true },
                    )
                    .setColor('Red')
                    .setTimestamp();
                logChannel.send({ embeds: [embed] }).catch(() => null);
            }
        } else if (entry.action === AuditLogEvent.MemberBanAdd || entry.action === AuditLogEvent.MemberKick) {
            this.restrictedActionLog.push(Date.now());

            // Clean up old log entries
            const oneMinuteAgo = Date.now() - 60 * 1000;
            this.restrictedActionLog = this.restrictedActionLog.filter(timestamp => timestamp > oneMinuteAgo);
            
            if (this.restrictedActionLog.length > this.actionLimit) {
                // Exceeded action limit, take action against executor
                const executorMember = await this.guildHolder.getGuild().members.fetch(entry.executor.id).catch(() => null);
                if (executorMember) {
                    // remove all roles
                    await executorMember.roles.set([], 'Anti-Nuke: Exceeded restricted action limit').catch(() => null);

                    // log the action
                    const logChannel = await this.getLogChannel();
                    if (logChannel) {
                        const embed = new EmbedBuilder()
                            .setTitle('Anti-Nuke: Executor Restricted')
                            .setDescription(`A user has exceeded the restricted action limit and has been stripped of their roles.`)
                            .addFields(
                                { name: 'Executor', value: `${entry.executor.tag} (${entry.executor.id})`, inline: true },
                                { name: 'Action', value: entry.action === AuditLogEvent.MemberBanAdd ? 'Ban' : 'Kick', inline: true },
                            )
                            .setColor('Red')
                            .setTimestamp();
                        logChannel.send({ embeds: [embed] }).catch(() => null);
                    }
                }
            }
        }
    }

    async handleRoleDelete(_role: Role) {

    }

    async handleMemberAdd(_member: GuildMember) {

    }

    async handleMemberUpdate(_oldMember: GuildMember | PartialGuildMember, _newMember: GuildMember) {
    }

    async handleMemberRemove(_member: GuildMember | PartialGuildMember) {
    }

    async handleMessageUpdate(_oldMessage: Message, _newMessage: Message) {

    }

    async handleMessageDelete(_message: Message) {

    }

    async handleThreadDelete(_thread: AnyThreadChannel) {
    }

    async handleThreadUpdate(_oldThread: AnyThreadChannel, _newThread: AnyThreadChannel) {

    }


}