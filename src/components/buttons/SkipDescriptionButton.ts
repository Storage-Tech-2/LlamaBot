import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, escapeDiscordString, replyEphemeral, truncateFileName } from "../../utils/Util.js";
import { AttachmentAskDescriptionData } from "../../submissions/Attachment.js";
import { SetDescriptionButton } from "./SetDescriptionButton.js";
import { SetImagesMenu } from "../menus/SetImagesMenu.js";
import { SetAttachmentsMenu } from "../menus/SetAttachmentsMenu.js";
import { getAttachmentDescriptionForMenus } from "../../utils/AttachmentUtils.js";

export class SkipDescriptionButton implements Button {
    getID(): string {
        return "skip-desc-btn";
    }

    getBuilder(isImage: boolean, attachmentID: Snowflake, taskID: string, all: boolean): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID() + '|' + (isImage ? 'i' : 'a') + '|' + attachmentID + '|' + taskID + '|' + (all ? '1' : '0'))
            .setLabel(all ? 'Skip All' : 'Skip')
            .setStyle(all ? ButtonStyle.Danger : ButtonStyle.Secondary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, type: string, attachmentID: Snowflake, taskID: string, all: string): Promise<void> {
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
        const isAll = all === '1';
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

        let skippedAttachment = null;

        if (!isAll) {
            // check if attachmentID is first in toAsk
            if (attachmentSetTaskData.toAsk.length === 0 || attachmentSetTaskData.toAsk[0].id !== attachmentID) {
                replyEphemeral(interaction, 'This attachment is not the current one to set description for.');
                return;
            }

            // remove from toAsk and add to toSet without description
            skippedAttachment = attachmentSetTaskData.toAsk.shift();
        } else {
            attachmentSetTaskData.toAsk.length = 0;
        }



        if (attachmentSetTaskData.toAsk.length > 0) {
            // ask for the next one
            const nextAttachment = attachmentSetTaskData.toAsk[0];
            const askButton = new SetDescriptionButton().getBuilder(nextAttachment.name, isImage, nextAttachment.id, taskID);
            const skipButton = new SkipDescriptionButton().getBuilder(isImage, nextAttachment.id, taskID, false);
            const row = new ActionRowBuilder().addComponents(askButton, skipButton);

            if (!skippedAttachment) {
                throw new Error('Skipped attachment is null when it should not be.');
            }

            const embeds = [];
            if (isImage) {
                const embed = new EmbedBuilder()
                    .setTitle(truncateFileName(escapeDiscordString(nextAttachment.name), 256))
                    .setDescription(getAttachmentDescriptionForMenus(nextAttachment) || 'No description')
                    .setThumbnail(nextAttachment.url);
                embeds.push(embed);
            } else {
                const embed = new EmbedBuilder()
                    .setTitle(truncateFileName(escapeDiscordString(nextAttachment.name), 256))
                    .setDescription(getAttachmentDescriptionForMenus(nextAttachment) || 'No description');
                embeds.push(embed);
            }

            await interaction.update({
                content: `Skipped description for **${escapeDiscordString(skippedAttachment.name)}**.` +
                    `\n\nSet a description for the next ${isImage ? 'image' : 'attachment'} **${escapeDiscordString(nextAttachment.name)}**?`,
                components: [row as any],
                embeds: embeds,
            });
        } else {
            // all done, set attachments
            await interaction.deferUpdate();
            guildHolder.getBot().getTempDataStore().removeEntry(taskID);
            if (isImage) {
                await SetImagesMenu.setAndReply(true, submission, interaction, attachmentSetTaskData.toSet);
            } else {
                await SetAttachmentsMenu.setAttachmentsAndSetResponse(true, submission, attachmentSetTaskData.toSet, interaction);
            }
        }

    }

}