import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { SetAttachmentsMenu } from "../menus/SetAttachmentsMenu.js";
import { SetImagesMenu } from "../menus/SetImagesMenu.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { SkipImagesButton } from "./SkipImagesButton.js";

export class SetAttachmentsButton implements Button {
    getID(): string {
        return "set-attachments-button";
    }

    getBuilder(isSet: boolean): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel(isSet ? "Change Attachments" : "Set Attachments")
            .setStyle(isSet ? ButtonStyle.Secondary : ButtonStyle.Primary);
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


        const shouldAlsoAskAttachments = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) !== null;
        await SetImagesMenu.sendImagesMenuAndButton(submission, interaction);
        if (shouldAlsoAskAttachments) {
            await SetAttachmentsMenu.sendAttachmentsMenuAndButton(submission, interaction);
        }

    }
}