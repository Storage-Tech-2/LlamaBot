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
        if (!interaction.channel || !data) {
            await replyEphemeral(interaction, 'No move conversation data found.');
            return;
        }

        await interaction.deferReply();

        const listToDelete = data.movedMessageIds.slice();
        
        // Delete status messages too
        if (data.statusMessages) {
            listToDelete.push(...data.statusMessages);
        }

        for (const messageId of listToDelete) {
            try {
                const message = await interaction.channel.messages.fetch(messageId as Snowflake).catch(() => null);
                if (message) {
                    await message.delete();
                }
            } catch (e) {
                console.error(`Failed to delete message ${messageId}:`, e);
            }
        }

        removeMoveConvoData(guildHolder.getBot(), interaction.user.id, interaction.channelId);

        await interaction.editReply({
            content: 'Move conversation undone.'
        });
    }
}