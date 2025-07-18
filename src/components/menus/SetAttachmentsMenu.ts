import { ActionRowBuilder, Interaction, Message, MessageFlags, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { canEditSubmission, escapeDiscordString, escapeString, replyEphemeral, splitIntoChunks, truncateFileName } from "../../utils/Util.js";
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

        await interaction.deferReply()

        const attachments = await submission.getAttachments()
        // const currentAttachments = submission.submissionData.attachments || []
        const newAttachments = interaction.values.map(id => {
            return attachments.find(attachment => attachment.id === id)
        }).filter(o => !!o);

        submission.getConfigManager().setConfig(SubmissionConfigs.ATTACHMENTS, newAttachments);
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
        const wdls: Attachment[] = []
        const videos: Attachment[] = []
        const others: Attachment[] = []
        newAttachments.forEach(attachment => {
            if (attachment.contentType === 'youtube' || attachment.contentType === 'bilibili') {
                videos.push(attachment)
            } else if (attachment.wdl) {
                wdls.push(attachment)
            } else if (attachment.litematic) {
                litematics.push(attachment)
            } else {
                others.push(attachment)
            }
        })

        if (litematics.length) {
            description += '**Litematics:**\n'
            litematics.forEach(attachment => {
                description += `- [${escapeDiscordString(escapeString(attachment.name))}](${attachment.url}): ${attachment.litematic?.error || `MC ${attachment.litematic?.version}, ${attachment.litematic?.size}`}\n`
            })
        }

        if (wdls.length) {
            description += '**WDLs:**\n'
            wdls.forEach(attachment => {
                description += `- [${escapeDiscordString(escapeString(attachment.name))}](${attachment.url}): ${attachment.wdl?.error || `MC ${attachment.wdl?.version}`}\n`
            })
        }

        if (videos.length) {
            description += '**Videos:**\n'
            videos.forEach(attachment => {
                if (attachment.contentType === 'bilibili') {
                    description += `- [${attachment.name}](${attachment.url}): Bilibili video\n`
                    return;
                }
                if (!attachment.youtube) {
                    description += `- [${escapeDiscordString(attachment.name)}](${attachment.url}): YouTube link\n`
                    return;
                }
                description += `- [${escapeDiscordString(attachment.youtube.title)}](${attachment.url}): by [${escapeDiscordString(attachment.youtube?.author_name)}](${attachment.youtube?.author_url})\n`
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
                    case 'discord':
                        type = 'Discord link';
                        break;
                }
                description += `- [${escapeDiscordString(escapeString(attachment.name))}](${attachment.url}): ${type}\n`
            })
        }

        const split = splitIntoChunks(description, 2000);
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