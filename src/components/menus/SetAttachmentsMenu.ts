import { ActionRowBuilder, Interaction, Message, MessageFlags, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { canEditSubmission, escapeString, replyEphemeral, truncateFileName } from "../../utils/Util.js";
import { Submission } from "../../submissions/Submission.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { Attachment } from "../../submissions/Attachment.js";
import { SkipAttachmentsButton } from "../buttons/SkipAttachmentsButton.js";
import { SetAttachmentsButton } from "../buttons/SetAttachmentsButton.js";

export class SetAttachmentsMenu implements Menu {
    getID(): string {
        return "set-attachments-menu";
    }

    getBuilder(fileAttachments: Attachment[], currentFiles: Attachment[]): StringSelectMenuBuilder {
        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(0)
            .setMaxValues(Math.min(10, fileAttachments.length))
            .setPlaceholder('Select files')
            .addOptions(
                fileAttachments.map(file => {
                    return new StringSelectMenuOptionBuilder().setLabel(truncateFileName(file.name, 50))
                        .setValue(file.id)
                        .setDescription(file.description.substring(0, 100))
                        .setDefault(currentFiles.some(att => att.id === file.id))
                })
            )
    }

    async getBuilderOrNull(submission: Submission): Promise<StringSelectMenuBuilder | null> {
        const attachments = await submission.getAttachments()
        const fileAttachments = attachments.filter(attachment => attachment.contentType && attachment.contentType !== 'application/x-msdos-program')

        if (!fileAttachments.length) {
            return null; // No file attachments available
        }
        const currentFiles = submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) || [];
        return this.getBuilder(fileAttachments, currentFiles);
    }

    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction): Promise<void> {
        const submissionId = interaction.channelId
        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return
        }

        if (
            !canEditSubmission(interaction, submission)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
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
        } catch (error: any) {
            console.error('Error processing attachments:', error)
            await interaction.editReply({
                content: 'Failed to process attachments: ' + error.message,
                flags: MessageFlags.SuppressEmbeds
            });
            return;
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
                description += `- [${escapeString(attachment.name)}](${attachment.url}): MC ${attachment.litematic?.version}, ${attachment.litematic?.size}\n`
            })
        }

        if (others.length) {
            description += '**Other files:**\n'
            others.forEach(attachment => {
                let type = attachment.contentType;
                switch (attachment.contentType) {
                    case 'mediafire':
                        type = 'Mediafire link';
                        break;
                    case 'youtube':
                        type = 'YouTube link';
                        break;
                    case 'discord':
                        type = 'Discord link';
                        break;
                }
                description += `- [${escapeString(attachment.name)}](${attachment.url}): ${type}\n`
            })
        }

        await interaction.editReply({
            content: description,
            flags: MessageFlags.SuppressEmbeds
        })

        await submission.statusUpdated();
        submission.checkReview();
    }

    public static async sendAttachmentsMenuAndButton(submission: Submission, interaction: Interaction): Promise<Message> {
        const menu = await new SetAttachmentsMenu().getBuilderOrNull(submission);
        if (menu) {
            const rows = [new ActionRowBuilder().addComponents(menu) as any];
            if (submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) === null) {
                rows.push(new ActionRowBuilder().addComponents(new SkipAttachmentsButton().getBuilder()))
            }
            return replyEphemeral(interaction, `Please choose other attachments (eg: Schematics/WDLs) for the submission`,{
                components: rows
            })
        } else {
            const row = new ActionRowBuilder().addComponents(new SetAttachmentsButton().getBuilder(false));
            if (submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) === null) {
                row.addComponents(new SkipAttachmentsButton().getBuilder())
            }
            return replyEphemeral(interaction, `No attachments found! Try uploading attachments first and then press the button below.`,
                {
                    flags: MessageFlags.Ephemeral,
                    components: [
                        row as any
                    ]
                });
        }
    }
}