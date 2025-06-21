import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, canPublishSubmission, replyEphemeral } from "../../utils/Util.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { SetImagesMenu } from "../menus/SetImagesMenu.js";
import { SetAttachmentsMenu } from "../menus/SetAttachmentsMenu.js";
import { SetAttachmentsButton } from "./SetAttachmentsButton.js";

export class SkipImagesButton implements Button {
    getID(): string {
        return "skip-images-button";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Skip Setting Images')
            .setStyle(ButtonStyle.Success);
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


        const images = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES);
        if (images !== null) {
            replyEphemeral(interaction, 'Images are already set for this submission');
            return;
        } else {
            submission.getConfigManager().setConfig(SubmissionConfigs.IMAGES, []);
            await interaction.reply({
                content: `<@${interaction.user.id}> skipped setting images for this submission. You can still add images later.`,
            });
        }

        await submission.statusUpdated();
        await SetAttachmentsMenu.sendAttachmentsMenuAndButton(submission, interaction);
        submission.checkReview()
    }

}