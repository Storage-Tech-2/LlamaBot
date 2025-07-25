import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { EditRevisionModal } from "../modals/EditRevisionModal.js";
export class EditSubmissionButton implements Button {
    getID(): string {
        return "edit-submission-button";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Edit Submission')
            .setStyle(ButtonStyle.Primary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction): Promise<void> {
        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, "Submission not found");
            return;
        }

        if (!canEditSubmission(interaction, submission)) {
            replyEphemeral(interaction, "You do not have permission to use this!");
            return;
        }

        const revision = await submission.getRevisionsManager().getRevisionById(interaction.message.id)
        if (!revision) {
            replyEphemeral(interaction, 'Revision not found')
            return
        }

        await interaction.showModal(new EditRevisionModal().getBuilder(guildHolder, revision))
    }
}