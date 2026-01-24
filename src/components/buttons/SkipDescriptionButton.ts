import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, escapeDiscordString, replyEphemeral } from "../../utils/Util.js";
import { AttachmentAskDescriptionData } from "../../submissions/Attachment.js";
import { SetDescriptionButton } from "./SetDescriptionButton.js";
import { SetImagesMenu } from "../menus/SetImagesMenu.js";
import { SetAttachmentsMenu } from "../menus/SetAttachmentsMenu.js";

export class SkipDescriptionButton implements Button {
    getID(): string {
        return "skip-desc-btn";
    }

    getBuilder(isImage: boolean, attachmentID: Snowflake, taskID: string): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID() + '|' + (isImage ? 'i' : 'a') + '|' + attachmentID + '|' + taskID)
            .setLabel('Skip Description')
            .setStyle(ButtonStyle.Danger);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, type: string, attachmentID: Snowflake, taskID: string): Promise<void> {
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

        const isImage = type === 'i';
        const processing = isImage ? submission.imagesProcessing : submission.attachmentsProcessing;

        if (processing) {
            replyEphemeral(interaction, `${isImage ? 'Images' : 'Attachments'} are currently being processed. Please wait until they are done.`);
            return;
        }

        const data = guildHolder.getBot().getTempDataStore().getEntry(taskID);
        const attachmentSetTaskData = data ? data.data as AttachmentAskDescriptionData : null;

        if (!attachmentSetTaskData) {
            replyEphemeral(interaction, 'Task data not found');
            return;
        }

        // check if attachmentID is first in toAsk
        if (attachmentSetTaskData.toAsk.length === 0 || attachmentSetTaskData.toAsk[0].id !== attachmentID) {
            replyEphemeral(interaction, 'This attachment is not the current one to set description for.');
            return;
        }

        // remove from toAsk and add to toSet without description
        const skippedAttachment = attachmentSetTaskData.toAsk.shift()!;
        skippedAttachment.description = '';



        if (attachmentSetTaskData.toAsk.length > 0) {
            // ask for the next one
            const nextAttachment = attachmentSetTaskData.toAsk[0];
            const askButton = new SetDescriptionButton().getBuilder(nextAttachment.name, isImage, nextAttachment.id, taskID);
            const skipButton = new SkipDescriptionButton().getBuilder(isImage, nextAttachment.id, taskID);
            const row = new ActionRowBuilder().addComponents(askButton, skipButton);

            await interaction.reply({
                content: `Skipped description for **${escapeDiscordString(skippedAttachment.name)}**.` +
                    `\n\nSet a description for the next ${isImage ? 'image' : 'attachment'} **${escapeDiscordString(nextAttachment.name)}**?`,
                flags: [MessageFlags.Ephemeral, MessageFlags.SuppressNotifications, MessageFlags.SuppressEmbeds],
                components: [row as any],
            });
        } else {
            // all done, set attachments
            guildHolder.getBot().getTempDataStore().removeEntry(taskID);
            if (isImage) {
                await SetImagesMenu.setAndReply(submission, interaction, attachmentSetTaskData.toSet);
            } else {
                await SetAttachmentsMenu.setAttachmentsAndSetResponse(submission, attachmentSetTaskData.toSet, interaction);
            }
        }

    }

}