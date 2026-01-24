import { LabelBuilder, ModalBuilder, ModalSubmitInteraction, Snowflake, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { canEditSubmission, replyEphemeral, truncateStringWithEllipsis } from "../../utils/Util.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { Attachment } from "../../submissions/Attachment.js";
import { AttachmentAskDescriptionData } from "../menus/SetAttachmentsMenu.js";

export class SetDescriptionModal implements Modal {
    getID(): string {
        return "set-description-modal";
    }

    getBuilder(attachmentName: string, id: Snowflake, taskID: string): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(this.getID() + '|' + id + '|' + taskID)
            .setTitle(truncateStringWithEllipsis(`Info for ${attachmentName}`, 45))

        const descriptionInput = new TextInputBuilder()
            .setCustomId('descriptionInput')
            .setPlaceholder('Optional description for the attachment')
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

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction, id: Snowflake, taskID: string): Promise<void> {
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

        if (submission.attachmentsProcessing) {
            replyEphemeral(interaction, 'Attachments are currently being processed. Please wait until they are done.');
            return;
        }

        const taskData = await guildHolder.getBot().getTempDataStore().getEntry(taskID);
        const attachmentSetTaskData = taskData ? taskData.data as AttachmentAskDescriptionData : null;
        const currentAttachments: Attachment[] = submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) || [];
        
        let foundAttachment = null;
        if (attachmentSetTaskData) {
            foundAttachment = attachmentSetTaskData.toSet.find(att => att.id === id);
        } else {
            foundAttachment = currentAttachments.find(att => att.id === id);
        }

        if (!foundAttachment) {
            replyEphemeral(interaction, 'Attachment not found!')
            return;
        }

        const description = (interaction.fields.getTextInputValue('descriptionInput') || '').replace(/\n/g, ' ').trim();

        foundAttachment.description = description;

      

        if (attachmentSetTaskData) {
            // update the task data as well
            if (attachmentSetTaskData.toAsk.includes(foundAttachment)) {
                attachmentSetTaskData.toAsk.splice(attachmentSetTaskData.toAsk.indexOf(foundAttachment), 1);
            }

            // are any left?
            if (attachmentSetTaskData.toAsk.length > 0) {
                // ask for the next one
                // const nextAttachment = attachmentSetTaskData.toAsk[0];
                // const askButton = new SetDescriptionButton().getBuilder(nextAttachment.name, nextAttachment.id, taskID);
            }
        } else if (currentAttachments.includes(foundAttachment)) {
            submission.getConfigManager().setConfig(SubmissionConfigs.ATTACHMENTS, currentAttachments);
        }

    }
}