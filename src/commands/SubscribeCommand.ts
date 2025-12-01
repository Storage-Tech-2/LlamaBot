import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType, Snowflake, ChannelType, MessageFlags } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { replyEphemeral } from "../utils/Util.js";
import { GuildConfigs } from "../config/GuildConfigs.js";

export class SubscribeCommand implements Command {
    getID(): string {
        return "subscribe";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Subscribe to submissions for a specific channel')
            .setContexts(InteractionContextType.Guild);
        data.addChannelOption(option =>
            option.setName('channel')
                .setDescription('The archive channel to subscribe to')
                .setRequired(true)
        );

        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (
            !interaction.inGuild()
        ) {
            await replyEphemeral(interaction, 'This command can only be used in a guild channel.')
            return;
        }

        const channelsToSubscribe: Snowflake[] = [];

        const channels = await guildHolder.getGuild().channels.fetch();
        const currentCategories = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS) as Snowflake[];
        const submissionsChannel = guildHolder.getConfigManager().getConfig(GuildConfigs.SUBMISSION_CHANNEL_ID);
        const channel = interaction.options.getChannel('channel', true);
           
        if (channel.id === submissionsChannel) {
            channels.filter(channel => {
                return channel && channel.type === ChannelType.GuildForum && channel.parentId && currentCategories.includes(channel.parentId)
            }).forEach(channel => {
                if (channel && channel.type === ChannelType.GuildForum) {
                    channelsToSubscribe.push(channel.id);
                }
            });
        } else {
            const forumChannel = channels.get(channel.id);
            if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
                await replyEphemeral(interaction, 'The specified channel is not a valid archive channel.');
                return;
            }
            if (!forumChannel.parentId || !currentCategories.includes(forumChannel.parentId)) {
                await replyEphemeral(interaction, 'The specified channel is not in a valid archive category.');
                return;
            }
            channelsToSubscribe.push(forumChannel.id);
        }

        const subscriptionManager = guildHolder.getSubscriptionManager();
        const count = await subscriptionManager.subscribeUserTo(interaction.user.id, channelsToSubscribe);

        if (count === 0) {
            await interaction.reply({
                content: `You are already subscribed to the specified channel(s).`,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        if (count === 1 && channelsToSubscribe.length === 1) {
            await interaction.reply({
                content: `You have been subscribed to <#${channelsToSubscribe[0]}>. You will receive notifications for new submissions in this channel.`,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        await interaction.reply({
            content: `You have been subscribed to ${count} channel(s). You will receive notifications for new submissions in these channels.`,
            flags: [MessageFlags.Ephemeral]
        });
    }

}