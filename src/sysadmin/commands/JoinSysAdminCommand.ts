import { ChannelType, Guild, GuildBasedChannel, Message, NewsChannel, PermissionFlagsBits, StageChannel, TextChannel, VoiceChannel } from "discord.js";
import { SysAdminCommand } from "../SysAdminCommand.js";
import { SysAdminCommandContext } from "../SysAdminCommandContext.js";
import { getConnectedGuild, getErrorMessage, isValidSnowflake } from "./SysAdminGuildUtils.js";

export class JoinSysAdminCommand implements SysAdminCommand {
    public aliases = ["join"];

    public async execute(context: SysAdminCommandContext, message: Message, args: string[]): Promise<void> {
        const guildId = args[0];
        if (!guildId || !isValidSnowflake(guildId)) {
            await message.reply("Usage: `/join <guild_id>`");
            return;
        }

        const guild = getConnectedGuild(context.client, guildId);
        if (!guild) {
            await message.reply(`Guild ${guildId} is not connected to the bot.`);
            return;
        }

        try {
            const inviteUrl = await this.getInviteUrl(guild);
            await message.reply(`Invite for ${guild.name} (${guild.id}):\n${inviteUrl}`);
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`Error running /join for guild ${guild.id}:`, error);
            await message.reply(`Failed to get invite for ${guild.name} (${guild.id}): ${errorMessage}`);
        }
    }

    private async getInviteUrl(guild: Guild): Promise<string> {
        const vanityUrl = await this.getVanityUrl(guild);
        if (vanityUrl) {
            return vanityUrl;
        }

        await guild.invites.fetch().catch(() => null);
        const cachedInvite = guild.invites.cache
            .sort((a, b) => {
                const aUnlimited = (a.maxUses ?? 0) === 0 && (a.maxAge ?? 0) === 0;
                const bUnlimited = (b.maxUses ?? 0) === 0 && (b.maxAge ?? 0) === 0;
                if (aUnlimited !== bUnlimited) {
                    return aUnlimited ? -1 : 1;
                }

                const aExpiry = a.expiresTimestamp ?? Number.MAX_SAFE_INTEGER;
                const bExpiry = b.expiresTimestamp ?? Number.MAX_SAFE_INTEGER;
                return bExpiry - aExpiry;
            })
            .first();
        if (cachedInvite) {
            return cachedInvite.url;
        }

        const botMember = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
        if (!botMember) {
            throw new Error("Bot membership in this guild could not be resolved.");
        }

        await guild.channels.fetch();
        const channels = guild.channels.cache
            .filter((channel): channel is NewsChannel | TextChannel | VoiceChannel | StageChannel => {
                if (!this.isInviteChannel(channel)) {
                    return false;
                }

                const perms = channel.permissionsFor(botMember);
                return perms?.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.CreateInstantInvite);
            })
            .sort((a, b) => a.rawPosition - b.rawPosition);

        for (const channel of channels.values()) {
            try {
                const invite = await channel.createInvite({
                    maxAge: 0,
                    maxUses: 0,
                    temporary: false,
                    unique: false,
                    reason: "SysAdmin /join command",
                });
                return invite.url;
            } catch {
                // Try the next accessible channel.
            }
        }

        throw new Error("No available invites and unable to create a new invite in any accessible channel.");
    }

    private isInviteChannel(channel: GuildBasedChannel): channel is NewsChannel | TextChannel | VoiceChannel | StageChannel {
        return channel.type === ChannelType.GuildAnnouncement
            || channel.type === ChannelType.GuildText
            || channel.type === ChannelType.GuildVoice
            || channel.type === ChannelType.GuildStageVoice;
    }

    private async getVanityUrl(guild: Guild): Promise<string | null> {
        if (guild.vanityURLCode) {
            return `https://discord.gg/${guild.vanityURLCode}`;
        }

        const vanityData = await guild.fetchVanityData().catch(() => null);
        if (vanityData?.code) {
            return `https://discord.gg/${vanityData.code}`;
        }

        return null;
    }
}
