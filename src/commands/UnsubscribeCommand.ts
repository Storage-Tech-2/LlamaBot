import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType, MessageFlags } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { replyEphemeral } from "../utils/Util.js";
import { GuildConfigs } from "../config/GuildConfigs.js";

export class UnsubscribeCommand implements Command {
    getID(): string {
        return "unsubscribe";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Unsubscribe to submissions for a specific channel')
            .setContexts(InteractionContextType.Guild);
        data.addChannelOption(option =>
            option.setName('channel')
                .setDescription('The archive channel to unsubscribe to')
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

        const submissionsChannel = guildHolder.getConfigManager().getConfig(GuildConfigs.SUBMISSION_CHANNEL_ID);
        const channel = interaction.options.getChannel('channel', true);
           
        if (channel.id === submissionsChannel) {
            const count = await guildHolder.getUserSubscriptionManager().unsubscribeUserFromAll(interaction.user.id);

            if (count === 0) {
                await interaction.reply({
                    content: `You are not subscribed to any channels.`,
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }
            await interaction.reply({
                content: `You have been unsubscribed from ${count} channel(s). You will no longer receive notifications for new submissions in these channels.`,
                flags: [MessageFlags.Ephemeral]
            });
        } else {
            const count = await guildHolder.getUserSubscriptionManager().unsubscribeUserFrom(interaction.user.id, [channel.id]);
            if (count === 0) {
                await interaction.reply({
                    content: `You are not subscribed to the specified channel.`,
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            await interaction.reply({
                content: `You have been unsubscribed from <#${channel.id}>. You will no longer receive notifications for new submissions in this channel.`,
                flags: [MessageFlags.Ephemeral]
            });
        }

    }

}