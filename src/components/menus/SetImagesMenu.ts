import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, Interaction, Message, MessageFlags, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { canEditSubmission, escapeDiscordString, replyEphemeral, truncateFileName } from "../../utils/Util.js";
import { Submission } from "../../submissions/Submission.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { Image } from "../../submissions/Image.js";
import path from "path";
import { SetAttachmentsMenu } from "./SetAttachmentsMenu.js";
import { SkipImagesButton } from "../buttons/SkipImagesButton.js";
import { filterImages, getFileKey } from "../../utils/AttachmentUtils.js";
import { AddImageButton } from "../buttons/AddImageButton.js";
import { RefreshListButton } from "../buttons/RefreshListButton.js";

export class SetImagesMenu implements Menu {
    getID(): string {
        return "set-images-menu";
    }

    getBuilder(imageAttachments: Image[], currentImages: Image[]): StringSelectMenuBuilder {
        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(0)
            .setMaxValues(Math.min(5, imageAttachments.length))
            .setPlaceholder('Select images')
            .addOptions(
                imageAttachments.map(image => {
                    return new StringSelectMenuOptionBuilder().setLabel(truncateFileName(image.name, 50))
                        .setValue(image.id)
                        .setDescription(image.description.substring(0, 100) || "No description")
                        .setDefault(currentImages.some(img => img.id === image.id))
                })
            )
    }

    async getBuilderOrNull(submission: Submission): Promise<StringSelectMenuBuilder | null> {
        const attachments = await submission.getAttachments()
        const currentImages = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) ?? [];

        currentImages.forEach(file => {
            if (!attachments.some(att => att.id === file.id)) {
                attachments.push({
                    id: file.id,
                    name: file.name,
                    url: file.url,
                    description: file.description,
                    contentType: file.contentType,
                    canDownload: true,
                })
            }
        });

        const imageAttachments = filterImages(attachments);

        if (!imageAttachments.length) {
            return null;
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

        const attachments = await submission.getAttachments()

        const currentImages = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) ?? [];
        const newImages = interaction.values.map((value) => {
            const found = attachments.find(attachment => attachment.id === value);
            if (found) {
                return found;
            }

            const imageFound = currentImages.find(img => img.id === value);
            if (imageFound) {
                return {
                    id: imageFound.id,
                    name: imageFound.name,
                    url: imageFound.url,
                    description: imageFound.description,
                    contentType: imageFound.contentType,
                    canDownload: true,
                }
            }

            return null;
        }).filter(o => !!o);
        const isFirstTime = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) === null;
        const added: Image[] = [];
        const removed: Image[] = [];

        newImages.forEach((image) => {
            if (!currentImages.some(img => img.id === image.id)) {
                added.push({
                    id: image.id,
                    name: image.name,
                    url: image.url,
                    description: image.description,
                    contentType: image.contentType
                });
            }
        });

        currentImages.forEach((image) => {
            if (!newImages.some(img => img.id === image.id)) {
                removed.push(image);
            }
        });

        if (added.length === 0 && removed.length === 0) {
            replyEphemeral(interaction, 'No changes made to images');
            return;
        }

        submission.getConfigManager().setConfig(SubmissionConfigs.IMAGES, newImages);
        await interaction.deferReply()
        try {
            await submission.processImages();
        } catch (error: any) {
            console.error('Error processing image:', error.message)
            interaction.editReply('Error processing image: ' + error.message);
            return
        }

        await submission.save();

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
        await interaction.editReply({
            content: newImages.length === 0 ? `<@${interaction.user.id}> marked this submission as containing no images` : `<@${interaction.user.id}> set main image${newImages.length > 1 ? 's' : ''} for submission`,
            embeds,
            files
        })

        await submission.statusUpdated();

        if (isFirstTime) {
            await SetAttachmentsMenu.sendAttachmentsMenuAndButton(submission, interaction);
        }

        submission.checkReview()
    }

    public static async sendImagesMenuAndButton(submission: Submission, interaction: Interaction): Promise<Message> {
        const menu = await new SetImagesMenu().getBuilderOrNull(submission);
        if (menu) {
            const rows = [new ActionRowBuilder().addComponents(menu)];
            const secondRow = new ActionRowBuilder().addComponents(new AddImageButton().getBuilder());
            if (submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) === null) {
                secondRow.addComponents(new SkipImagesButton().getBuilder());
            }
            rows.push(secondRow);

            return replyEphemeral(interaction, `Please choose images for the submission`, {
                components: rows
            })
        } else {
            const row = new ActionRowBuilder().addComponents(new RefreshListButton().getBuilder(true), new AddImageButton().getBuilder());
            if (submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) === null) {
                row.addComponents(new SkipImagesButton().getBuilder())
            }
            return replyEphemeral(interaction, `No images found! Try uploading images first and then press the button below.`,
                {
                    flags: MessageFlags.Ephemeral,
                    components: [
                        row
                    ]
                });
        }
    }

}