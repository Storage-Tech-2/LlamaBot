import { MessageFlags, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Menu } from "../../interface/Menu";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { Submission } from "../../submissions/Submission";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs";
import { Attachment } from "../../submissions/Attachment";

export class SetAttachmentsMenu implements Menu {
    getID(): string {
        return "set-attachments-menu";
    }

    async getBuilder(_guildHolder: GuildHolder, submission: Submission): Promise<StringSelectMenuBuilder> {
        const attachments = await submission.getAttachments()
        const fileAttachments = attachments.filter(attachment => !attachment.contentType || (!attachment.contentType.startsWith('image/') && !attachment.contentType.startsWith('video/') && !attachment.contentType.startsWith('audio/')))

        if (!fileAttachments.length) {
            return new StringSelectMenuBuilder()
                .setCustomId(this.getID())
                .setMinValues(1)
                .setMaxValues(1)
                .setPlaceholder('No files found. Try uploading a file first')
                .addOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel('No files found')
                        .setValue('none')
                        .setDescription('No files found')
                ])
        }

        const currentFiles = submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) || [];

        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(0)
            .setMaxValues(Math.min(10, fileAttachments.length))
            .setPlaceholder('Select files')
            .addOptions(
                fileAttachments.map(file => {
                    return new StringSelectMenuOptionBuilder().setLabel(file.name)
                        .setValue(file.id)
                        .setDescription(file.description)
                        .setDefault(currentFiles.some(att => att.id === file.id))
                })
            )
    }

    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction): Promise<void> {
        if (
            !isOwner(interaction) &&
            !hasPerms(interaction)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return
        }

        const submissionId = interaction.channelId
        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return
        }

        if (submission.attachmentsProcessing) {
            replyEphemeral(interaction, 'Attachments are currently being processed. Please wait until they are done.');
            return;
        }

        if (interaction.values.includes('none')) {
            replyEphemeral(interaction, 'No files found')
            return
        }

        const attachments = await submission.getAttachments()
        // const currentAttachments = submission.submissionData.attachments || []
        const newAttachments = interaction.values.map(id => {
            return attachments.find(attachment => attachment.id === id)
        }).filter(o => !!o);

        submission.getConfigManager().setConfig(SubmissionConfigs.ATTACHMENTS, newAttachments);
        await interaction.deferReply()
        try {
            await submission.processAttachments()
        } catch (error) {
            console.error('Error processing attachments:', error)
        }

        submission.save()

        let description = `Attachments set by <@${interaction.user.id}>:\n\n`

        const litematics: Attachment[] = []
        const others: Attachment[] = []
        newAttachments.forEach(attachment => {
            if (attachment.litematic) {
                litematics.push(attachment)
            } else {
                others.push(attachment)
            }
        })

        if (litematics.length) {
            description += '**Litematics:**\n'
            litematics.forEach(attachment => {
                description += `- [${attachment.name}](${attachment.url}): MC ${attachment.litematic?.version}, ${attachment.litematic?.size}\n`
            })
        }

        if (others.length) {
            description += '**Other files:**\n'
            others.forEach(attachment => {
                description += `- [${attachment.name}](${attachment.url}): ${attachment.contentType}\n`
            })
        }

        await interaction.editReply({
            content: description,
            flags: MessageFlags.SuppressEmbeds
        })

        await submission.statusUpdated();
        submission.checkReview();
    }

}