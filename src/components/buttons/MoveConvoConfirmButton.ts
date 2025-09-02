import { ButtonBuilder, ButtonInteraction, ButtonStyle, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { getMoveConvoData, removeMoveConvoData } from "../../support/MoveConvoTool.js";
import { replyEphemeral } from "../../utils/Util.js";
export class MoveConvoConfirmButton implements Button {
    getID(): string {
        return "mv-confirm-button";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Success);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction): Promise<void> {
        const data = getMoveConvoData(guildHolder.getBot(), interaction.user.id, interaction.channelId);
        if (!interaction.channel || !data) {
            await replyEphemeral(interaction, 'No move conversation data found.');
            return;
        }

        const original = await interaction.reply({
            content: 'Removing original conversation... This may take a while for large conversations.',
        });


        const listToDelete = data.toMoveMessageIds.slice();
        
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

        await original.edit({
            content: 'Conversation moved successfully!'
        });
    }
}