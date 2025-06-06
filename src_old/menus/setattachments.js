const Utils = require('../util/Utils')
const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags } = require('discord.js')

module.exports = class SetAttachments {
  static async getComponent (guildHolder, submission) {
    const attachments = await submission.getAttachments(guildHolder)
    const fileAttachments = attachments.filter(attachment => !attachment.contentType || (!attachment.contentType.startsWith('image/') && !attachment.contentType.startsWith('video/') && !attachment.contentType.startsWith('audio/')))

    if (!fileAttachments.length) {
      return new StringSelectMenuBuilder()
        .setCustomId(this.getName())
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

    const currentFiles = (submission.submissionData.attachments || []).map(attachment => attachment.id)

    return new StringSelectMenuBuilder()
      .setCustomId(this.getName())
      .setMinValues(1)
      .setMaxValues(Math.min(10, fileAttachments.length))
      .setPlaceholder('Select files')
      .addOptions(
        fileAttachments.map(image => {
          return new StringSelectMenuOptionBuilder().setLabel(image.name)
            .setValue(image.id)
            .setDescription(image.__description)
            .setDefault(currentFiles.includes(image.id))
        })
      )
  }

  static getName () {
    return 'setattachments'
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
    const newAttachmentIds = interaction.values
    if (newAttachmentIds.includes('none')) {
      Utils.replyEphemeral(interaction, 'No files found')
      return
    }
    // const currentAttachments = submission.submissionData.attachments || []
    const newAttachments = newAttachmentIds.map(id => {
      const attachment = attachments.find(attachment => attachment.id === id)
      return {
        id: attachment.id,
        name: attachment.name,
        url: attachment.url,
        contentType: attachment.contentType,
        description: attachment.__description
      }
    })
    submission.submissionData.attachments = newAttachments
    await interaction.deferReply()
    try {
      await submission.processAttachments()
    } catch (error) {
      console.error('Error processing attachments:', error)
    }

    submission.save()

    let description = `Attachments set by <@${interaction.user.id}>:\n\n`

    const litematics = []
    const others = []
    submission.submissionData.attachments.forEach(attachment => {
      const ext = attachment.name.split('.').pop()
      if (ext === 'litematic') {
        litematics.push(attachment)
      } else {
        others.push(attachment)
      }
    })

    if (litematics.length) {
      description += '**Litematics:**\n'
      litematics.forEach(attachment => {
        description += `- [${attachment.name}](${attachment.url}): MC ${attachment.version}, ${attachment.size}\n`
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

    submission.updateStarterMessage(guildHolder)
    submission.reviewStageCheck(guildHolder)
  }
}
