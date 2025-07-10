import { ButtonBuilder, ButtonInteraction, ButtonStyle, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { EditRevisionModal } from "../modals/EditRevisionModal.js";
import { Revision } from "../../submissions/Revision.js";
export class FixErrorsButton implements Button {
    getID(): string {
        return "fix-errors-button";
    }

    getBuilder(revision: Revision, tempID: string): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID() + '|' + revision.id + '|' + tempID)
            .setLabel('Fix Errors')
            .setStyle(ButtonStyle.Primary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, revisionID: Snowflake, tempID: string): Promise<void> {
        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, "Submission not found");
            return;
        }

        if (!canEditSubmission(interaction, submission)) {
            replyEphemeral(interaction, "You do not have permission to use this!");
            return;
        }

        const revision = await submission.getRevisionsManager().getRevisionById(revisionID);
        if (!revision) {
            replyEphemeral(interaction, 'Revision not found')
            return
        }

        await interaction.showModal(new EditRevisionModal().getBuilder(guildHolder, revision, tempID))
    }
}