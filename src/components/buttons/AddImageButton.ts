import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { AddImageModal } from "../modals/AddImageModal.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";

export class AddImageButton implements Button {
    getID(): string {
        return "add-image-button";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Add Image Not In List')
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

        // check if images exceed 5
        if ((submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) || []).length >= 5) {
            replyEphemeral(interaction, 'You cannot add more than 5 images to a submission!');
            return;
        }

        const modal = new AddImageModal().getBuilder()
        await interaction.showModal(modal);
    }
}