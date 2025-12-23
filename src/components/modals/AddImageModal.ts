import { AttachmentBuilder, EmbedBuilder, FileBuilder, FileUploadBuilder, LabelBuilder, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { canEditSubmission, escapeDiscordString, replyEphemeral } from "../../utils/Util.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { filterImages, getFileKey } from "../../utils/AttachmentUtils.js";
import { Image } from "../../submissions/Image.js";
import path from "path";
import { SetAttachmentsMenu } from "../menus/SetAttachmentsMenu.js";

export class AddImageModal implements Modal {
    getID(): string {
        return "add-image-modal";
    }

    getBuilder(): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(this.getID())
            .setTitle('Add Image')

        const uploadInput = new FileUploadBuilder()
            .setCustomId('attachmentInput')
            .setMaxValues(1)
            .setMinValues(1)
            .setRequired(true);

        const uploadLabel = new LabelBuilder()
            .setLabel('Upload image:')
            .setFileUploadComponent(uploadInput);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('descriptionInput')
            .setPlaceholder('Optional description for the image')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        const descriptionLabel = new LabelBuilder()
            .setLabel('Image Description:')
            .setTextInputComponent(descriptionInput);

        modal.addLabelComponents(
            uploadLabel,
            descriptionLabel
        );

        return modal
    }

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction): Promise<void> {
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

        if (submission.imagesProcessing) {
            replyEphemeral(interaction, 'Images are currently being processed. Please wait until they are done.');
            return;
        }

        const uploadedAttachment = interaction.fields.getUploadedFiles('attachmentInput', true).first();
        const description = (interaction.fields.getTextInputValue('descriptionInput') || '').replace(/\n/g, ' ').trim();

        if (!uploadedAttachment) {
            replyEphemeral(interaction, 'No attachment uploaded. Please try again.');
            return;
        }

        const submissionChannel = await submission.getSubmissionChannel();
        if (!submissionChannel || !submissionChannel.parent) {
            replyEphemeral(interaction, 'Submission channel not found.');
            return;
        }

        const imageObj: Image = {
            id: uploadedAttachment.id,
            name: uploadedAttachment.name,
            url: uploadedAttachment.url,
            description: description || `Added by ${interaction.user.username} at ${Date.toLocaleString()}`,
            contentType: uploadedAttachment.contentType || 'unknown'
        };

        if (filterImages([imageObj]).length === 0) {
            replyEphemeral(interaction, 'The provided attachment is not a valid image.');
            return;
        }


        await interaction.deferReply();

        // const webhook = await submissionChannel.parent.createWebhook({
        //     name: 'LlamaBot Attachment Uploader',
        // });

        // const member = interaction.guild?.members.cache.get(interaction.user.id);

        // await webhook.send({
        //     username: member?.displayName || interaction.user.username,
        //     avatarURL: member?.displayAvatarURL(),
        //     content: description.length > 0 ? `Description: ${description}` : '',
        //     allowedMentions: { parse: [] },
        //     threadId: submissionChannel.id,
        //     files: [
        //         {
        //             name: imageObj.name,
        //             attachment: imageObj.url
        //         }
        //     ]
        // }).catch((e) => {
        //     console.log("Failed to post with webhook", e)
        // });

        // await webhook.delete().catch(() => { /* ignore */ });

        const isFirstTime = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) === null;
        const currentImages = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) ?? [];
        currentImages.push(imageObj);
        submission.getConfigManager().setConfig(SubmissionConfigs.IMAGES, currentImages);

        try {
            await submission.processImages();
        } catch (error: any) {
            console.error('Error processing image:', error.message)
            interaction.editReply('Error processing image: ' + error.message);
            return
        }

        await submission.save();
        
        let message = `<@${interaction.user.id}> added image: ${imageObj.url}`;
        if (description.length > 0) {
            message += ` with description`;
        }

        const processedFolder = submission.getProcessedImagesFolder();
        const key = getFileKey(imageObj, 'png');
        const processedPath = path.join(processedFolder, key)
        const file = new AttachmentBuilder(processedPath);
        const embed = new EmbedBuilder()
            .setTitle(escapeDiscordString(imageObj.name))
            .setImage(`attachment://${key}`)

        if (imageObj.description) {
            embed.setFooter({ text: imageObj.description.substring(0, 2048) });
        }

        await interaction.editReply({
            content: message,
            embeds: [embed],
            files: [file]
        })

        await submission.statusUpdated();

        if (isFirstTime) {
            await SetAttachmentsMenu.sendAttachmentsMenuAndButton(submission, interaction);
        }

        submission.checkReview();
    }
}