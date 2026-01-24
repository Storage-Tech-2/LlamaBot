import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { AddAttachmentModal } from "../modals/AddAttachmentModal.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";

export class AddAttachmentButton implements Button {
    getID(): string {
        return "add-attachment-button";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Add Attachment Not In List')
            .setStyle(ButtonStyle.Primary)
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction): Promise<void> {
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

        // check if attachments exceed 25
        if ((submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) || []).length >= 25) {
            replyEphemeral(interaction, 'You cannot add more than 25 attachments to a submission!');
            return;
        }

        const modal = new AddAttachmentModal().getBuilder()
        await interaction.showModal(modal);
    }
}