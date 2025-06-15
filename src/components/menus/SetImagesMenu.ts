import { ActionRowBuilder, AttachmentBuilder, BaseSelectMenuBuilder, Channel, ChannelSelectMenuBuilder, ChannelType, Collection, EmbedBuilder, ForumChannel, MessageFlags, Snowflake, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, ThreadChannel } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Menu } from "../../interface/Menu";
import { getFileKey, hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { Submission } from "../../submissions/Submission";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs";
import { Image } from "../../submissions/Image";
import path from "path";
import { SetAttachmentsMenu } from "./SetAttachmentsMenu";

export class SetImagesMenu implements Menu {
    getID(): string {
        return "set-images-menu";
    }

    async getBuilder(guildHolder: GuildHolder, submission: Submission): Promise<StringSelectMenuBuilder> {
        const attachments = await submission.getAttachments()
        const imageAttachments = attachments.filter(attachment => attachment.contentType && (attachment.contentType.startsWith('image/png') || attachment.contentType.startsWith('image/jpeg')))

        if (!imageAttachments.length) {
            return new StringSelectMenuBuilder()
                .setCustomId(this.getID())
                .setMinValues(1)
                .setMaxValues(1)
                .setPlaceholder('No images found. Try uploading an PNG/JPEG image first')
                .addOptions([
                    new StringSelectMenuOptionBuilder()
                        .setLabel('No images found')
                        .setValue('none')
                        .setDescription('No images found')
                ])
        }

        const currentImages = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) || [];
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

    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction, ...args: string[]): Promise<void> {
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
        } catch (error) {
            console.error('Error processing image:', error)
            replyEphemeral(interaction, 'Error processing image. Please try again later.')
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

        submission.statusUpdated();

        if (isFirstTime) {
            const row = new ActionRowBuilder()
                .addComponents(await new SetAttachmentsMenu().getBuilder(guildHolder, submission))
            await interaction.followUp({
                content: `<@${interaction.user.id}> Please choose other attachments (Schematics/WDLS) for your submission`,
                components: [row as any],
                flags: MessageFlags.Ephemeral
            })
        }

        submission.checkReview()
    }

}