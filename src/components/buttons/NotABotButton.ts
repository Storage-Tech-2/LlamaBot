import { ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { replyEphemeral } from "../../utils/Util.js";
import { AttachmentsState } from "../../support/UserData.js";
export class NotABotButton implements Button {
    getID(): string {
        return "not-a-bot-button";
    }

    getBuilder(id: Snowflake): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID() + '|' + id)
            .setLabel('I am not a bot')
            .setStyle(ButtonStyle.Primary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, userID: Snowflake): Promise<void> {
        const userData = await guildHolder.getUserManager().getOrCreateUserData(interaction.user.id, interaction.user.username);
        if (userData.attachmentsAllowedState === AttachmentsState.ALLOWED) {
            replyEphemeral(interaction, `You have already confirmed you're not a bot and can send attachments or links.`);
            return;
        }

        userData.attachmentsAllowedState = AttachmentsState.ALLOWED;
        userData.messagesToDeleteOnTimeout = []; // Clear messages to delete on timeout
        await guildHolder.getUserManager().saveUserData(userData);

        await interaction.reply({
            content: `Thank you for confirming you're not a bot! You can now send messages with attachments or links.`,
            flags: MessageFlags.Ephemeral,
        });

        // check if the interaction user is the same as the original user, then delete original message
        if (interaction.user.id === userID) {
            const originalMessage = interaction.message;
            await originalMessage.delete();
        }
    }
}
