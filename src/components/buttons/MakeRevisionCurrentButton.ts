import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";


export class MakeRevisionCurrentButton implements Button {
    getID(): string {
        return "make-revision-current";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Make Current')
            .setStyle(ButtonStyle.Primary)
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
        await submission.getRevisionsManager().setCurrentRevision(revision.id);
        const channel = await submission.getSubmissionChannel();
        if (!channel) {
            replyEphemeral(interaction, 'Submission channel not found. Please try again later.');
            return;
        }
        const message = await channel.messages.fetch(revision.id);
        await interaction.reply({
            content: `<@${interaction.user.id}> changed current revision to ${message.url}`
        });
        submission.statusUpdated();
    }
}