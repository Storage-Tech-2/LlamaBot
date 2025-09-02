import { ButtonBuilder, ButtonInteraction, ButtonStyle, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { getMoveConvoData, removeMoveConvoData } from "../../support/MoveConvoTool.js";
import { replyEphemeral } from "../../utils/Util.js";
export class MoveConvoCancelButton implements Button {
    getID(): string {
        return "mv-cancel-button";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Undo')
            .setStyle(ButtonStyle.Danger);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction): Promise<void> {
        const data = getMoveConvoData(guildHolder.getBot(), interaction.user.id, interaction.channelId);
        if (!interaction.channel || !data || !data.moveToChannelId) {
            await replyEphemeral(interaction, 'No move conversation data found.');
            return;
        }

        const original = await interaction.reply({
            content: 'Undoing move conversation... This may take a while for large conversations.',
        });

        // Delete status messages
        for (const messageId of data.statusMessages) {
            try {
                const message = await interaction.channel.messages.fetch(messageId as Snowflake).catch(() => null);
                if (message) {
                    await message.delete();
                }
            } catch (e) {
                console.error(`Failed to delete status message ${messageId}:`, e);
            }
        }

        const listToDelete = data.movedMessageIds.slice();

        const channel = await guildHolder.getGuild().channels.fetch(data.moveToChannelId).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            await replyEphemeral(interaction, 'Destination channel not found. Please contact an admin to manually move the messages back.');
            return;
        }

        for (const messageId of listToDelete) {
            try {
                const message = await channel.messages.fetch(messageId as Snowflake).catch(() => null);
                if (message) {
                    await message.delete();
                }
            } catch (e) {
                console.error(`Failed to delete message ${messageId}:`, e);
            }
        }

        removeMoveConvoData(guildHolder.getBot(), interaction.user.id, interaction.channelId);

        await original.edit({
            content: 'Move conversation undone!'
        });
    }
}