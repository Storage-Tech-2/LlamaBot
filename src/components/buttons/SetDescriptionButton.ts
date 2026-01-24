import { ButtonBuilder, ButtonInteraction, ButtonStyle, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral, truncateStringWithEllipsis } from "../../utils/Util.js";
import { SetDescriptionModal } from "../modals/SetDescriptionModal.js";

export class SetDescriptionButton implements Button {
    getID(): string {
        return "set-description-button";
    }

    getBuilder(attachmentName: string, id: Snowflake, taskID: string): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID() + '|' + id + '|' + taskID)
            .setLabel(truncateStringWithEllipsis(`Set info: ${attachmentName}`, 80))
            .setStyle(ButtonStyle.Primary)
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, id: Snowflake, taskID: string): Promise<void> {
        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found');
            return;
        }

        if (
            !canEditSubmission(interaction, submission)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return;
        }

        if (submission.attachmentsProcessing) {
            replyEphemeral(interaction, 'Attachments are currently being processed. Please wait until they are done.');
            return;
        }

        const attachment = await submission.getAttachmentById(id).catch(() => null);

        const modal = new SetDescriptionModal().getBuilder(attachment?.name || "Unknown", id, taskID);
        await interaction.showModal(modal);
    }
}