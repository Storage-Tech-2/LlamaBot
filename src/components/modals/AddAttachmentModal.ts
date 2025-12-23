import { FileUploadBuilder, LabelBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { canEditSubmission, escapeDiscordString, replyEphemeral, splitIntoChunks } from "../../utils/Util.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { Attachment } from "../../submissions/Attachment.js";
import { filterAttachments, getAttachmentsFromText } from "../../utils/AttachmentUtils.js";

export class AddAttachmentModal implements Modal {
    getID(): string {
        return "add-attachment-modal";
    }

    getBuilder(): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(this.getID())
            .setTitle('Add Attachment')

        const uploadInput = new FileUploadBuilder()
            .setCustomId('attachmentInput')
            .setMaxValues(1)
            .setRequired(false);

        const uploadLabel = new LabelBuilder()
            .setLabel('Upload attachment:')
            .setFileUploadComponent(uploadInput);

        const urlInput = new TextInputBuilder()
            .setCustomId('urlInput')
            .setPlaceholder('Or put a URL here instead')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        const urlLabel = new LabelBuilder()
            .setLabel('URL (optional):')
            .setTextInputComponent(urlInput);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('descriptionInput')
            .setPlaceholder('Optional description for the attachment')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

        const descriptionLabel = new LabelBuilder()
            .setLabel('Attachment Description:')
            .setTextInputComponent(descriptionInput);

        modal.addLabelComponents(
            uploadLabel,
            urlLabel,
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

        if (submission.attachmentsProcessing) {
            replyEphemeral(interaction, 'Attachments are currently being processed. Please wait until they are done.');
            return;
        }

        const uploadedAttachment = interaction.fields.getUploadedFiles('attachmentInput')?.first();
        const url = interaction.fields.getTextInputValue('urlInput');
        const description = (interaction.fields.getTextInputValue('descriptionInput') || '').replace(/\n/g, ' ').trim();

        if (!uploadedAttachment && !url) {
            replyEphemeral(interaction, 'No attachment uploaded or URL provided. Please try again.');
            return;
        }

        if (uploadedAttachment && url) {
            replyEphemeral(interaction, 'Please provide either an uploaded attachment or a URL, not both.');
            return;
        }

        const textAttachments = getAttachmentsFromText(url);
        if (textAttachments.length === 0 && !uploadedAttachment) {
            replyEphemeral(interaction, 'No valid attachments found at the provided URL.');
            return;
        }

        // create webhook
        const submissionChannel = await submission.getSubmissionChannel();
        if (!submissionChannel || !submissionChannel.parent) {
            replyEphemeral(interaction, 'Submission channel not found.');
            return;
        }

        if (textAttachments.length > 0) {
            textAttachments[0].description = description;
        }

        const attachmentObj: Attachment = !uploadedAttachment ? textAttachments[0] : {
            id: uploadedAttachment.id,
            name: uploadedAttachment.name,
            url: uploadedAttachment.url,
            description: description,
            contentType: uploadedAttachment.contentType || 'unknown',
            canDownload: true,
        };

        if (filterAttachments([attachmentObj]).length === 0) {
            replyEphemeral(interaction, 'The provided attachment type is not supported.');
            return;
        }

        await interaction.deferReply();

        const webhook = await submissionChannel.parent.createWebhook({
            name: 'LlamaBot Attachment Uploader',
        });

        const member = interaction.guild?.members.cache.get(interaction.user.id);

         await webhook.send({
            username: member?.displayName || interaction.user.username,
            avatarURL: member?.displayAvatarURL(),
            content: description.length > 0 ? `Description: ${description}` : '',
            allowedMentions: { parse: [] },
            threadId: submissionChannel.id,
            files: [
                {
                    name: attachmentObj.name,
                    attachment: attachmentObj.url
                }
            ]
        }).catch((e) => {
            console.log("Failed to post with webhook", e)
        });


        await webhook.delete().catch(() => { /* ignore */ });


        const currentAttachments = submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) ?? [];
        currentAttachments.push(attachmentObj);
        submission.getConfigManager().setConfig(SubmissionConfigs.ATTACHMENTS, currentAttachments);

        try {
            await submission.processAttachments()
        } catch (error: any) {
            console.error('Error processing attachments:', error)
            await interaction.editReply({
                content: 'Failed to process attachments: ' + error.message,
                flags: MessageFlags.SuppressEmbeds
            });
            return;
        }

        await submission.save();

        let message = `<@${interaction.user.id}> added `;
        if (attachmentObj.youtube || attachmentObj.contentType === 'youtube' || attachmentObj.contentType === 'bilibili') {
            if (attachmentObj.youtube) {
                message += `YouTube video: [${escapeDiscordString(attachmentObj.youtube.title)}](${attachmentObj.url}): by [${escapeDiscordString(attachmentObj.youtube?.author_name)}](${attachmentObj.youtube?.author_url})`;
            } else {
                message += `YouTube video: [${escapeDiscordString(attachmentObj.name)}](${attachmentObj.url})`;
            }
        } else if (attachmentObj.contentType === 'bilibili') {
            message += `Bilibili video: [${escapeDiscordString(attachmentObj.name)}](${attachmentObj.url})`;
        } else if (attachmentObj.wdl) {
            message += `WDL: [${escapeDiscordString(attachmentObj.name)}](${attachmentObj.url}): ${attachmentObj.wdl?.error || `MC ${attachmentObj.wdl?.version}`}`;
        } else if (attachmentObj.litematic) {
            message += `Litematic: [${escapeDiscordString(attachmentObj.name)}](${attachmentObj.url}): ${attachmentObj.litematic?.error || `MC ${attachmentObj.litematic?.version}, ${attachmentObj.litematic?.size}`}`;
        } else if (attachmentObj.contentType === 'mediafire') {
            message += `Mediafire link: [${escapeDiscordString(attachmentObj.name)}](${attachmentObj.url})`;
        } else if (attachmentObj.contentType === 'discord') {
            message += `Discord attachment: [${escapeDiscordString(attachmentObj.name)}](${attachmentObj.url})`;
        } else {
            message += `attachment: [${escapeDiscordString(attachmentObj.name)}](${attachmentObj.url})`;
        }

        if (description.length > 0) {
            message += ` with description: ${description}`;
        }

        const split = splitIntoChunks(message, 2000);
        await interaction.editReply({
            content: split[0],
            flags: MessageFlags.SuppressEmbeds
        })

        if (split.length > 1) {
            for (let i = 1; i < split.length; i++) {
                await interaction.followUp({
                    content: split[i],
                    flags: MessageFlags.SuppressEmbeds
                })
            }
        }
        await submission.statusUpdated();
        submission.checkReview();
    }
}