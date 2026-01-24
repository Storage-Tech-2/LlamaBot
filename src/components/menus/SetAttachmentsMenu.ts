import { ActionRowBuilder, Interaction, Message, MessageFlags, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { canEditSubmission, replyEphemeral, splitIntoChunks, truncateFileName, truncateStringWithEllipsis } from "../../utils/Util.js";
import { Submission } from "../../submissions/Submission.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { Attachment } from "../../submissions/Attachment.js";
import { SkipAttachmentsButton } from "../buttons/SkipAttachmentsButton.js";
import { filterAttachments, getAttachmentDescriptionForMenus, getAttachmentsSetMessage } from "../../utils/AttachmentUtils.js";
import { AddAttachmentButton } from "../buttons/AddAttachmentButton.js";
import { RefreshListButton } from "../buttons/RefreshListButton.js";

export type AttachmentAskDescriptionData = {
    toAsk: Attachment[];
    toSet: Attachment[];
}
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
                        .setDescription(truncateStringWithEllipsis(getAttachmentDescriptionForMenus(file), 100) || "No description")
                        .setDefault(currentFiles.some(att => att.id === file.id))
                })
            )
    }

    async getBuilderOrNull(submission: Submission): Promise<StringSelectMenuBuilder | null> {
        const attachments = await submission.getAttachments()
        const currentAttachments = submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) ?? [];

        currentAttachments.forEach(file => {
            if (!attachments.some(att => att.id === file.id)) {
                attachments.push(file);
            }
        });

        const fileAttachments = filterAttachments(attachments);

        if (!fileAttachments.length) {
            return null; // No file attachments available
        }

        // if more than 25 attachments, limit to first 25
        if (fileAttachments.length > 25) {
            let toRemove = fileAttachments.length - 25;
            for (let i = fileAttachments.length - 1; i >= 0 && toRemove > 0; i--) {
                const file = fileAttachments[i];
                if (!currentAttachments.some(att => att.id === file.id)) {
                    fileAttachments.splice(i, 1);
                    toRemove--;
                }
            }

            // if still more than 25, slice the array
            if (fileAttachments.length > 25) {
                fileAttachments.splice(25);
            }
        }

        return this.getBuilder(fileAttachments, currentAttachments);
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
        const currentAttachments = submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) ?? [];
        const newAttachments = interaction.values.map(id => {
            return attachments.find(attachment => attachment.id === id) ?? currentAttachments.find(attachment => attachment.id === id);
        }).filter(o => !!o);

        const addedAttachmentsWithoutDescriptions = newAttachments.filter(newAtt => {
            return !newAtt.description && !currentAttachments.some(currAtt => currAtt.id === newAtt.id);
        });

        // if (addedAttachmentsWithoutDescriptions.length > 0) {
        //     const data = {
        //         toAsk: addedAttachmentsWithoutDescriptions,
        //         toSet: newAttachments
        //     }

        //     const identifier = guildHolder.getBot().getTempDataStore().getNewId();
        //     guildHolder.getBot().getTempDataStore().addEntry(identifier, data, 30 * 60 * 1000); // 30 minutes
        // } else {
        // await interaction.update({
        //     content: 'Processing attachments...',
        //     components: [],
        //     flags: MessageFlags.SuppressEmbeds
        // }); // clear loading state
        await SetAttachmentsMenu.setAttachmentsAndSetResponse(submission, newAttachments, interaction);
        // }
    }

    public static async setAttachmentsAndSetResponse(submission: Submission, newAttachments: Attachment[], interaction: StringSelectMenuInteraction): Promise<void> {
        submission.getConfigManager().setConfig(SubmissionConfigs.ATTACHMENTS, newAttachments);
        try {
            await submission.processAttachments()
        } catch (error: any) {
            console.error('Error processing attachments:', error)
            if (interaction.deferred) {
                await interaction.editReply({
                    content: 'Failed to process attachments: ' + error.message,
                    flags: MessageFlags.SuppressEmbeds
                });
            } else {
                await interaction.reply({
                    content: 'Failed to process attachments: ' + error.message,
                    flags: [MessageFlags.Ephemeral, MessageFlags.SuppressEmbeds]
                });
            }
            return;
        }

        const newAttachmentsProcessed = submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) ?? [];

        submission.save()

        let description = `Attachments set by <@${interaction.user.id}>:\n\n` + getAttachmentsSetMessage(newAttachmentsProcessed);

        const split = splitIntoChunks(description, 2000);
        if (interaction.deferred) {
            await interaction.editReply({
                content: split[0],
                flags: MessageFlags.SuppressEmbeds
            })
        } else {
            await interaction.reply({
                content: split[0],
                flags: MessageFlags.SuppressEmbeds
            })
        }

        for (let i = 1; i < split.length; i++) {
            if (!interaction.channel || !interaction.channel.isSendable()) continue;
            await interaction.channel.send({
                content: split[i],
                flags: MessageFlags.SuppressEmbeds
            })
        }

        await submission.statusUpdated();
        submission.checkReview();
    }

    public static async sendAttachmentsMenuAndButton(submission: Submission, interaction: Interaction, useUpdate: boolean = false) {
        const menu = await new SetAttachmentsMenu().getBuilderOrNull(submission);
        if (menu) {
            const rows = [new ActionRowBuilder().addComponents(menu)];
            const secondRow = new ActionRowBuilder().addComponents(new RefreshListButton().getBuilder(false), new AddAttachmentButton().getBuilder());
            if (submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) === null) {
                secondRow.addComponents(new SkipAttachmentsButton().getBuilder())
            }
            rows.push(secondRow);

            if (interaction.isButton() && useUpdate) {
                await interaction.update({
                    content: `Please choose other attachments (eg: Schematics/WDLs) for the submission`,
                    components: rows as any
                });
                return;
            } else {
                await replyEphemeral(interaction, `Please choose other attachments (eg: Schematics/WDLs) for the submission`, {
                    components: rows
                })
                return;
            }
        } else {
            const row = new ActionRowBuilder().addComponents(new RefreshListButton().getBuilder(false), new AddAttachmentButton().getBuilder());
            if (submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) === null) {
                row.addComponents(new SkipAttachmentsButton().getBuilder())
            }
            if (interaction.isButton() && useUpdate) {
                await interaction.update({
                    content: `No attachments found! Try uploading attachments first and then press the button below.`,
                    components: [
                        row as any
                    ]
                });
                return;
            } else {
                await replyEphemeral(interaction, `No attachments found! Try uploading attachments first and then press the button below.`,
                    {
                        flags: MessageFlags.Ephemeral,
                        components: [
                            row
                        ]
                    });
                return;
            }
        }
    }
}