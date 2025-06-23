import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, Interaction, Message, MessageFlags, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { canEditSubmission, getFileKey, replyEphemeral } from "../../utils/Util.js";
import { Submission } from "../../submissions/Submission.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { Image } from "../../submissions/Image.js";
import path from "path";
import { SetAttachmentsMenu } from "./SetAttachmentsMenu.js";
import { SetAttachmentsButton } from "../buttons/SetAttachmentsButton.js";
import { SkipImagesButton } from "../buttons/SkipImagesButton.js";

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
                    return new StringSelectMenuOptionBuilder().setLabel(image.name)
                        .setValue(image.id)
                        .setDescription(image.description)
                        .setDefault(currentImages.some(img => img.id === image.id))
                })
            )
    }

    async getBuilderOrNull(submission: Submission): Promise<StringSelectMenuBuilder | null> {
        const attachments = await submission.getAttachments()
        const imageAttachments = attachments.filter(attachment => {
            if (!attachment.contentType) {
                return false;
            }
            if (attachment.name.endsWith('.png') || attachment.name.endsWith('.jpg') || attachment.name.endsWith('.jpeg')) {
                return true;
            }

            if (attachment.contentType.startsWith('image/png') || attachment.contentType.startsWith('image/jpeg')) {
                return true;
            }
            return false;
        })

        if (!imageAttachments.length) {
            return null;
        }

        const currentImages = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) || [];
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

        const newImages = interaction.values.map((value) => {
            return attachments.find(attachment => attachment.id === value);
        }).filter(o => !!o);
        const isFirstTime = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) === null;
        const currentImages = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) || [];

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

        const files = [];
        const embeds = [];
        const processedFolder = submission.getProcessedImagesFolder();
        for (const attachment of newImages) {
            const key = getFileKey(attachment, 'png');
            const processedPath = path.join(processedFolder, key)
            const file = new AttachmentBuilder(processedPath)
            files.push(file);

            const embed = new EmbedBuilder()
                .setTitle(attachment.name)
                .setImage(`attachment://${key}`)
            embeds.push(embed);
        }
        await interaction.editReply({
            content: `<@${interaction.user.id}> set main image${newImages.length > 1 ? 's' : ''} for submission`,
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
            const rows = [new ActionRowBuilder().addComponents(menu) as any];
            if (submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) === null) {
                rows.push(new ActionRowBuilder().addComponents(new SkipImagesButton().getBuilder()))
            }

            return replyEphemeral(interaction, `Please choose images for the submission`,{
                components: rows
            })
        } else {
            const row = new ActionRowBuilder().addComponents(new SetAttachmentsButton().getBuilder(false));
            if (submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) === null) {
                row.addComponents(new SkipImagesButton().getBuilder())
            }
            return replyEphemeral(interaction,`No images found! Try uploading images first and then press the button below.`,
            {
                flags: MessageFlags.Ephemeral,
                components: [
                    row as any
                ]
            });
        }
    }

}