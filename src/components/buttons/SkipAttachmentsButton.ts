import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";

export class SkipAttachmentsButton implements Button {
    getID(): string {
        return "skip-attachments-button";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Skip Attachments')
            .setStyle(ButtonStyle.Danger);
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
            return
        }

        const attachments = submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS);
        if (attachments !== null) {
            replyEphemeral(interaction, 'Other attachments are already set for this submission');
            return;
        } else {
            submission.getConfigManager().setConfig(SubmissionConfigs.ATTACHMENTS, []);
            await interaction.reply({
                content: `<@${interaction.user.id}> skipped setting other attachments for this submission. You can still add attachments later.`,
            });
        }

        await submission.statusUpdated();
        submission.checkReview()
    }

}