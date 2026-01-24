import { ActionRowBuilder, LabelBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, Snowflake, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { canEditSubmission, escapeDiscordString, replyEphemeral, truncateStringWithEllipsis } from "../../utils/Util.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { AttachmentAskDescriptionData, BaseAttachment } from "../../submissions/Attachment.js";
import { SetDescriptionButton } from "../buttons/SetDescriptionButton.js";
import { SkipDescriptionButton } from "../buttons/SkipDescriptionButton.js";
import { SetAttachmentsMenu } from "../menus/SetAttachmentsMenu.js";
import { SetImagesMenu } from "../menus/SetImagesMenu.js";

export class SetDescriptionModal implements Modal {
    getID(): string {
        return "set-desc-mdl";
    }

    getBuilder(attachmentName: string, isImage: boolean, id: Snowflake, taskID: string): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(this.getID() + '|' + (isImage ? 'i' : 'a') + '|' + id + '|' + taskID)
            .setTitle(truncateStringWithEllipsis(`Info for ${attachmentName}`, 45))

        const descriptionInput = new TextInputBuilder()
            .setCustomId('descriptionInput')
            .setPlaceholder('Optional description')
            .setMaxLength(300)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        const descriptionLabel = new LabelBuilder()
            .setLabel('Attachment Description:')
            .setTextInputComponent(descriptionInput);

        modal.addLabelComponents(
            descriptionLabel
        );

        return modal
    }

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction, type: string, id: Snowflake, taskID: string): Promise<void> {
        const submissionId = interaction.channelId
        if (!submissionId) {
            replyEphemeral(interaction, 'Submission ID not found')
            return
        }

        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return
        }

        if (
            !canEditSubmission(interaction, submission)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return;
        }

        const isImage = type === 'i';
        const processing = isImage ? submission.imagesProcessing : submission.attachmentsProcessing;
        if (processing) {
            replyEphemeral(interaction, `${isImage ? 'Images' : 'Attachments'} are currently being processed. Please wait until they are done.`);
            return;
        }

        const taskData = await guildHolder.getBot().getTempDataStore().getEntry(taskID);
        const attachmentSetTaskData = taskData ? taskData.data as AttachmentAskDescriptionData : null;
        const currentAttachments: BaseAttachment[] = submission.getConfigManager().getConfig(isImage ? SubmissionConfigs.IMAGES : SubmissionConfigs.ATTACHMENTS) || [];
        
        let foundAttachment = null;
        if (attachmentSetTaskData) {
            foundAttachment = attachmentSetTaskData.toSet.find(att => att.id === id);
        } else {
            foundAttachment = currentAttachments.find(att => att.id === id);
        }

        if (!foundAttachment) {
            replyEphemeral(interaction, `${isImage ? 'Image' : 'Attachment'} not found!`)
            return;
        }

        const description = (interaction.fields.getTextInputValue('descriptionInput') || '').replace(/\n/g, ' ').trim();

        if (description.length > 300) {
            replyEphemeral(interaction, 'Description cannot exceed 300 characters!');
            return;
        }

        foundAttachment.description = description;

      

        if (attachmentSetTaskData) {
            // update the task data as well
            if (attachmentSetTaskData.toAsk.includes(foundAttachment)) {
                attachmentSetTaskData.toAsk.splice(attachmentSetTaskData.toAsk.indexOf(foundAttachment), 1);
            }

            // are any left?
            if (attachmentSetTaskData.toAsk.length > 0) {
                // ask for the next one
                const nextAttachment = attachmentSetTaskData.toAsk[0];
                const askButton = new SetDescriptionButton().getBuilder(nextAttachment.name, isImage, nextAttachment.id, taskID);
                const skipButton = new SkipDescriptionButton().getBuilder(isImage, nextAttachment.id, taskID);
                const row = new ActionRowBuilder().addComponents(askButton, skipButton);

                await interaction.reply({
                    content: `Set info for ${isImage ? 'image' : 'attachment'} **${escapeDiscordString(foundAttachment.name)}**:\n${foundAttachment.description ? `Description: ${foundAttachment.description}` : 'No description set.'}` +
                        `\n\nSet a description for the next ${isImage ? 'image' : 'attachment'} **${escapeDiscordString(nextAttachment.name)}**?`,
                    flags: [MessageFlags.Ephemeral, MessageFlags.SuppressNotifications, MessageFlags.SuppressEmbeds],
                    components: [row as any],
                });
            } else {
                // all done, set attachments
                await interaction.deferReply();
                guildHolder.getBot().getTempDataStore().removeEntry(taskID);
                if (isImage) {
                    await SetImagesMenu.setAndReply(submission, interaction, attachmentSetTaskData.toSet);
                } else {
                    await SetAttachmentsMenu.setAttachmentsAndSetResponse(submission, attachmentSetTaskData.toSet, interaction);
                }
            }
        } else if (currentAttachments.includes(foundAttachment)) {
            submission.getConfigManager().setConfig(SubmissionConfigs.ATTACHMENTS, currentAttachments);
            await submission.save();

            await interaction.reply({
                content: `<@${interaction.user.id}> set info for ${isImage ? 'image' : 'attachment'} **${escapeDiscordString(foundAttachment.name)}**:\n${foundAttachment.description ? `Description: ${foundAttachment.description}` : 'No description set.'}`,
                flags: [MessageFlags.SuppressNotifications, MessageFlags.SuppressEmbeds],
                allowedMentions: { parse: [] }
            });
        }

    }
}