import { ActionRowBuilder, EmbedBuilder, LabelBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, Snowflake, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { canEditSubmission, deepClone, escapeDiscordString, replyEphemeral, truncateFileName, truncateStringWithEllipsis } from "../../utils/Util.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { AttachmentAskDescriptionData, BaseAttachment } from "../../submissions/Attachment.js";
import { SetDescriptionButton } from "../buttons/SetDescriptionButton.js";
import { SkipDescriptionButton } from "../buttons/SkipDescriptionButton.js";
import { SetAttachmentsMenu } from "../menus/SetAttachmentsMenu.js";
import { SetImagesMenu } from "../menus/SetImagesMenu.js";
import { changeAttachmentName, changeImageName, getAttachmentDescriptionForMenus, getFileExtension, getFileNameWithoutExtension, isAttachmentImage } from "../../utils/AttachmentUtils.js";
import { EditInfoMultipleButton } from "../buttons/EditInfoMultipleButton.js";

export class AttachmentInfoModal implements Modal {
    getID(): string {
        return "att-info-mdl";
    }

    getBuilder(ordinal: number, attachmentName: string, attachmentDescription: string, isImage: boolean, id: Snowflake, taskID: string): ModalBuilder {

        const modal = new ModalBuilder()
            .setCustomId(this.getID() + '|' + (isImage ? 'i' : 'a') + '|' + id + '|' + taskID)
            .setTitle(truncateStringWithEllipsis(`Info for ${attachmentName}`, 45))

        const nameInput = new TextInputBuilder()
            .setCustomId('nameInput')
            .setPlaceholder('Attachment Name')
            .setMaxLength(100)
            .setValue(getFileNameWithoutExtension(attachmentName))
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const nameLabel = new LabelBuilder()
            .setLabel('Attachment Name:')
            .setTextInputComponent(nameInput);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('descriptionInput')
            .setPlaceholder('Optional description')
            .setMaxLength(300)
            .setValue(attachmentDescription)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        const descriptionLabel = new LabelBuilder()
            .setLabel('Attachment Description:')
            .setTextInputComponent(descriptionInput);

        const orderInput = new TextInputBuilder()
            .setCustomId('orderInput')
            .setPlaceholder('Lower numbers are displayed first.')
            .setStyle(TextInputStyle.Short)
            .setValue(ordinal.toString())
            .setRequired(true)

        const orderLabel = new LabelBuilder()
            .setLabel('Ordinal:')
            .setTextInputComponent(orderInput);


        modal.addLabelComponents(
            nameLabel,
            descriptionLabel,
            orderLabel
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

        const taskData = taskID.length > 0 ? await guildHolder.getBot().getTempDataStore().getEntry(taskID) : null;
        const attachmentSetTaskData = taskData ? taskData.data as AttachmentAskDescriptionData : null;
        const currentAttachments: BaseAttachment[] = submission.getConfigManager().getConfig(isImage ? SubmissionConfigs.IMAGES : SubmissionConfigs.ATTACHMENTS) || [];

        let foundAttachmentIndex: number = -1;
        let foundAttachment = null;

        if (attachmentSetTaskData) {
            foundAttachmentIndex = attachmentSetTaskData.toSet.findIndex(att => att.id === id);
            if (foundAttachmentIndex !== -1) {
                foundAttachment = attachmentSetTaskData.toSet[foundAttachmentIndex];
            }
        } else {
            foundAttachmentIndex = currentAttachments.findIndex(att => att.id === id);
            if (foundAttachmentIndex !== -1) {
                foundAttachment = currentAttachments[foundAttachmentIndex];
            }
        }

        if (!foundAttachment) {
            replyEphemeral(interaction, `${isImage ? 'Image' : 'Attachment'} not found!`)
            return;
        }

        const name = interaction.fields.getTextInputValue('nameInput');
        const description = (interaction.fields.getTextInputValue('descriptionInput') || '').replace(/\n/g, ' ').trim();
        const ordinal = parseInt(interaction.fields.getTextInputValue('orderInput')) || 0;
        const ordinalClamped = Math.min(Math.max(1, ordinal), currentAttachments.length);
        if (description.length > 300) {
            replyEphemeral(interaction, 'Description cannot exceed 300 characters!');
            return;
        }

        if (name.length === 0 || name.length > 100) {
            replyEphemeral(interaction, 'Name must be between 1 and 100 characters long!');
            return;
        }

        const oldFileNameWithoutExt = getFileNameWithoutExtension(foundAttachment.name);
        const oldFileExtension = getFileExtension(foundAttachment.name);

        if (oldFileNameWithoutExt === name && foundAttachment.description === description && ordinalClamped === foundAttachmentIndex + 1) {
            replyEphemeral(interaction, 'No changes were made to the attachment info.');
            return;
        }

        const oldFile = deepClone(foundAttachment);
        foundAttachment.name = oldFileExtension ? `${name}.${oldFileExtension}` : name;
        foundAttachment.description = description;

        // update ordinal
        if (ordinalClamped !== foundAttachmentIndex + 1) {
            // move the attachment in the array
            const arrayToModify = attachmentSetTaskData ? attachmentSetTaskData.toSet : currentAttachments;
            arrayToModify.splice(foundAttachmentIndex, 1);
            arrayToModify.splice(ordinalClamped - 1, 0, foundAttachment);
        }

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
                const skipButton = new SkipDescriptionButton().getBuilder(isImage, nextAttachment.id, taskID, false);
                const row = new ActionRowBuilder().addComponents(askButton, skipButton);


                const embed = new EmbedBuilder();

                embed.setTitle(truncateFileName(escapeDiscordString(nextAttachment.name), 256))
                    .setDescription(getAttachmentDescriptionForMenus(nextAttachment) || 'No description');

                if (isAttachmentImage(nextAttachment)) {
                    embed.setThumbnail(nextAttachment.url);
                }

                if (interaction.isFromMessage()) {
                    await interaction.update({
                        content: `Set info for ${isImage ? 'image' : 'attachment'} **${escapeDiscordString(foundAttachment.name)}**:\n${foundAttachment.description ? `Description: ${foundAttachment.description}` : 'No description set.'}` +
                            `\n\nSet a description for the next ${isImage ? 'image' : 'attachment'} **${escapeDiscordString(nextAttachment.name)}**?`,
                        components: [row as any],
                        embeds: [embed]
                    });
                }
            } else {
                // all done, set attachments
                await interaction.deferUpdate();
                guildHolder.getBot().getTempDataStore().removeEntry(taskID);
                if (isImage) {
                    await SetImagesMenu.setAndReply(submission, interaction, attachmentSetTaskData.toSet);
                } else {
                    await SetAttachmentsMenu.setAttachmentsAndSetResponse(submission, attachmentSetTaskData.toSet, interaction);
                }
            }
        } else if (currentAttachments.includes(foundAttachment)) {
            if (isImage) {
                submission.getConfigManager().setConfig(SubmissionConfigs.IMAGES, currentAttachments);
            } else {
                submission.getConfigManager().setConfig(SubmissionConfigs.ATTACHMENTS, currentAttachments);
            }

            if (oldFileNameWithoutExt !== name) {
                // rename the file on disk
                if (isImage) {
                    await changeImageName(submission.getProcessedImagesFolder(), oldFile, foundAttachment);
                } else {
                    await changeAttachmentName(submission.getAttachmentFolder(), oldFile, foundAttachment);
                }
            }

            await submission.save();

            if (interaction.isFromMessage()) {
                await (new EditInfoMultipleButton()).sendAttachmentEditButtons(submission, isImage, interaction);
            }

            const message = [`<@${interaction.user.id}> updated info for ${isImage ? 'image' : 'attachment'} **${escapeDiscordString(foundAttachment.name)}**:`];
            if (oldFileNameWithoutExt !== name) {
                message.push(`- Name changed: ${escapeDiscordString(oldFile.name)} → ${escapeDiscordString(foundAttachment.name)}`);
            }
            if (oldFile.description !== description) {
                message.push(`- Description ${description.length > 0 ? `set to: ${description}` : 'removed'}`);
            }
            if (ordinalClamped !== foundAttachmentIndex + 1) {
                message.push(`- Moved from position ${foundAttachmentIndex + 1} to ${ordinalClamped}`);
            }

            if (interaction.channel && interaction.channel.isSendable()) {
                await interaction.channel.send({
                    content: truncateStringWithEllipsis(message.join('\n'), 2000),
                    flags: [MessageFlags.SuppressNotifications, MessageFlags.SuppressEmbeds],
                    allowedMentions: { parse: [] }
                });
            }

        }

    }
}