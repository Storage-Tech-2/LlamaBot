const Utils = require('../util/Utils')
const { StringSelectMenuBuilder, AttachmentBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder, EmbedBuilder, MessageFlags } = require('discord.js')
const SetAttachments = require('./setattachments')

module.exports = class SetImage {
  static async getComponent (guildHolder, submission) {
    const attachments = await submission.getAttachments(guildHolder)
    const imageAttachments = attachments.filter(attachment => attachment.contentType && (attachment.contentType.startsWith('image/png') || attachment.contentType.startsWith('image/jpeg')))

    if (!imageAttachments.length) {
      return new StringSelectMenuBuilder()
        .setCustomId(this.getName())
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

    return new StringSelectMenuBuilder()
      .setCustomId(this.getName())
      .setMinValues(1)
      .setMaxValues(1)
      .setPlaceholder('Select image')
      .addOptions(
        imageAttachments.map(image => {
          return new StringSelectMenuOptionBuilder().setLabel(image.name)
            .setValue(image.id)
            .setDescription(image.__description)
            .setDefault(submission.submissionData.image === image.id)
        })
      )
  }

  static getName () {
    return 'setimage'
  }

  static async execute (interaction, bot) {
    if (
      !Utils.isOwner(interaction) &&
      !Utils.hasPerms(interaction)
    ) {
      Utils.replyEphemeral(interaction, 'You do not have permission to use this!')
      return
    }

    const guildId = interaction.guildId
    const guildHolder = bot.guilds.get(guildId)

    const submissionId = interaction.channelId
    const submission = await guildHolder.getSubmission(submissionId)
    if (!submission) {
      Utils.replyEphemeral(interaction, 'Submission not found')
      return
    }

    const attachments = await submission.getAttachments(guildHolder)

    const newImage = interaction.values[0]
    if (newImage === 'none') {
      return
    }
    const imageAttachment = attachments.find(attachment => attachment.id === newImage)
    if (!imageAttachment) {
      Utils.replyEphemeral(interaction, 'Image not found')
      return
    }
    const currentImage = submission.submissionData.image
    if (currentImage?.id === newImage) {
      Utils.replyEphemeral(interaction, 'Image already set to this image')
      return
    }

    const image = {
      id: imageAttachment.id,
      name: imageAttachment.name,
      url: imageAttachment.url,
      description: imageAttachment.__description,
      contentType: imageAttachment.contentType
    }
    submission.submissionData.image = image
    submission.save()

    await interaction.deferReply()
    try {
      await submission.processImage()
    } catch (error) {
      console.error('Error processing image:', error)
      Utils.replyEphemeral(interaction, 'Error processing image. Please try again later.')
      return
    }

    const file = new AttachmentBuilder(submission.submissionData.image.processed)
    const embed = new EmbedBuilder()
      .setTitle(submission.submissionData.image.name)
      .setImage('attachment://processed.png')

    await interaction.editReply({
      content: `<@${interaction.user.id}> set main image!`,
      embeds: [embed],
      files: [file]
    })

    submission.updateStarterMessage(guildHolder)

    if (!currentImage && !submission.submissionData.attachments) {
      const row = new ActionRowBuilder()
        .addComponents(await SetAttachments.getComponent(guildHolder, submission))
      await interaction.followUp({
        content: `<@${interaction.user.id}> Please select Schematics/WDLS`,
        components: [row],
        flags: MessageFlags.Ephemeral
      })
    }

    submission.reviewStageCheck(guildHolder)
  }
}
