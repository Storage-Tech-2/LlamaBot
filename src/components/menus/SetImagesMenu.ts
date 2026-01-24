import { ActionRowBuilder, AttachmentBuilder, ButtonInteraction, EmbedBuilder, Interaction, MessageFlags, ModalSubmitInteraction, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { canEditSubmission, escapeDiscordString, replyEphemeral, truncateFileName, truncateStringWithEllipsis } from "../../utils/Util.js";
import { Submission } from "../../submissions/Submission.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import path from "path";
import { SetAttachmentsMenu } from "./SetAttachmentsMenu.js";
import { SkipImagesButton } from "../buttons/SkipImagesButton.js";
import { filterImages, getAttachmentDescriptionForMenus, getFileKey } from "../../utils/AttachmentUtils.js";
import { AddImageButton } from "../buttons/AddImageButton.js";
import { RefreshListButton } from "../buttons/RefreshListButton.js";
import { BaseAttachment } from "../../submissions/Attachment.js";

export class SetImagesMenu implements Menu {
    getID(): string {
        return "set-images-menu";
    }

    getBuilder(imageAttachments: BaseAttachment[], currentImages: BaseAttachment[]): StringSelectMenuBuilder {
        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(0)
            .setMaxValues(Math.min(5, imageAttachments.length))
            .setPlaceholder('Select images')
            .addOptions(
                imageAttachments.map(image => {
                    return new StringSelectMenuOptionBuilder().setLabel(truncateFileName(image.name, 50))
                        .setValue(image.id)
                        .setDescription(truncateStringWithEllipsis(getAttachmentDescriptionForMenus(image), 100) || "No description")
                        .setDefault(currentImages.some(img => img.id === image.id))
                })
            )
    }

    async getBuilderOrNull(submission: Submission): Promise<StringSelectMenuBuilder | null> {
        const attachments = await submission.getAttachments()
        const currentImages = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) ?? [];

        currentImages.forEach(file => {
            if (!attachments.some(att => att.id === file.id)) {
                attachments.push(file);
            }
        });

        const imageAttachments = filterImages(attachments);

        if (!imageAttachments.length) {
            return null;
        }

        // limit to 25 images, removing non-current first
        if (imageAttachments.length > 25) {
            let toRemove = imageAttachments.length - 25;
            for (let i = imageAttachments.length - 1; i >= 0 && toRemove > 0; i--) {
                const file = imageAttachments[i];
                if (!currentImages.some(att => att.id === file.id)) {
                    imageAttachments.splice(i, 1);
                    toRemove--;
                }
            }

            // if still more than 25, slice the array
            if (imageAttachments.length > 25) {
                imageAttachments.splice(25);
            }
        }

        return this.getBuilder(imageAttachments, currentImages);
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


        if (submission.imagesProcessing) {
            replyEphemeral(interaction, 'Images are currently being processed. Please wait until they are done.');
            return;
        }

        if (interaction.values.includes('none')) {
            replyEphemeral(interaction, 'No files found')
            return
        }

        await interaction.deferUpdate();

        const attachments = await submission.getAttachments()

        const currentImages = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) ?? [];
        const newImages: BaseAttachment[] = interaction.values.map((value) => {
            const found = attachments.find(attachment => attachment.id === value);
            if (found) {
                return found;
            }
            const imageFound = currentImages.find(img => img.id === value);
            if (imageFound) {
                return imageFound;
            }
            return null;
        }).filter(o => !!o);

        const added: BaseAttachment[] = [];
        const removed: BaseAttachment[] = [];

        newImages.forEach((image) => {
            if (!currentImages.some(img => img.id === image.id)) {
                added.push(image);
            }
        });

        currentImages.forEach((image) => {
            if (!newImages.some(img => img.id === image.id)) {
                removed.push(image);
            }
        });

        if (added.length === 0 && removed.length === 0) {
            await interaction.editReply('No changes made to images.');
            return;
        }

        await SetImagesMenu.setAndReply(submission, interaction, newImages);
    }

    public static async setAndReply(submission: Submission, interaction: StringSelectMenuInteraction | ModalSubmitInteraction | ButtonInteraction, newImages: BaseAttachment[]) {

        const isFirstTime = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) === null;
        submission.getConfigManager().setConfig(SubmissionConfigs.IMAGES, newImages);

        try {
            await submission.processImages();
        } catch (error: any) {
            console.error('Error processing image:', error.message)
            await interaction.editReply('Error processing image: ' + error.message);
            return
        }

        await submission.save();

        if (interaction.isStringSelectMenu()) {
            await this.sendImagesMenuAndButton(submission, interaction, true);
        }

        const files = [];
        const embeds = [];
        const processedFolder = submission.getProcessedImagesFolder();
        for (const attachment of newImages) {
            const key = getFileKey(attachment, 'png');
            const processedPath = path.join(processedFolder, key)
            const file = new AttachmentBuilder(processedPath)
            files.push(file);

            const embed = new EmbedBuilder()
                .setTitle(escapeDiscordString(attachment.name))
                .setImage(`attachment://${key}`)

            if (attachment.description) {
                embed.setFooter({ text: attachment.description.substring(0, 2048) });
            }

            embeds.push(embed);
        }

        if (interaction.isStringSelectMenu()) {
            await interaction.followUp({
                content: newImages.length === 0 ? `<@${interaction.user.id}> marked this submission as containing no images` : `<@${interaction.user.id}> set main image${newImages.length > 1 ? 's' : ''} for submission`,
                embeds,
                files,
                flags: [MessageFlags.SuppressNotifications],
                allowedMentions: { parse: [] }
            })
        } else {
            await interaction.editReply({
                content: newImages.length === 0 ? `<@${interaction.user.id}> marked this submission as containing no images` : `<@${interaction.user.id}> set main image${newImages.length > 1 ? 's' : ''} for submission`,
                embeds,
                files,
                allowedMentions: { parse: [] }
            })
        }

        await submission.statusUpdated();

        if (isFirstTime) {
            await SetAttachmentsMenu.sendAttachmentsMenuAndButton(submission, interaction);
        }

        submission.checkReview()
    }

    public static async sendImagesMenuAndButton(submission: Submission, interaction: Interaction, useUpdate: boolean = false) {
        const menu = await new SetImagesMenu().getBuilderOrNull(submission);
        if (menu) {
            const rows = [new ActionRowBuilder().addComponents(menu)];
            const secondRow = new ActionRowBuilder().addComponents(new RefreshListButton().getBuilder(true), new AddImageButton().getBuilder());
            if (submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) === null) {
                secondRow.addComponents(new SkipImagesButton().getBuilder());
            }
            rows.push(secondRow);

            if ((interaction.isButton() || interaction.isStringSelectMenu()) && useUpdate) {
                await interaction.update({
                    content: `Please choose images for the submission`,
                    components: rows as any
                });
                return;
            } else {
                await replyEphemeral(interaction, `Please choose images for the submission`, {
                    components: rows
                });
                return;
            }
        } else {
            const row = new ActionRowBuilder().addComponents(new RefreshListButton().getBuilder(true), new AddImageButton().getBuilder());
            if (submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) === null) {
                row.addComponents(new SkipImagesButton().getBuilder())
            }
            if ((interaction.isButton() || interaction.isStringSelectMenu()) && useUpdate) {
                await interaction.update({
                    content: `No images found! Try uploading images first and then press the button below.`,
                    components: [
                        row as any
                    ]
                });
                return;
            } else {
                await replyEphemeral(interaction, `No images found! Try uploading images first and then press the button below.`,
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