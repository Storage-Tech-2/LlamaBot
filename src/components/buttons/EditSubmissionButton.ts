import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { EditRevisionModalPart1 } from "../modals/EditRevisionModalPart1";

export class EditSubmissionButton implements Button {
    getID(): string {
        return "edit-submission-button";
    }

    async getBuilder(): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Edit Submission')
            .setStyle(ButtonStyle.Primary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, ...args: string[]): Promise<void> {
        if (!isOwner(interaction) && !hasPerms(interaction)) {
            replyEphemeral(interaction, "You do not have permission to use this!");
            return;
        }

        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, "Submission not found");
            return;
        }

        const revision = await submission.getRevisionsManager().getRevisionById(interaction.message.id)
        if (!revision) {
            replyEphemeral(interaction, 'Revision not found')
            return
        }

        await interaction.showModal(await new EditRevisionModalPart1().getBuilder(revision))
    }
}