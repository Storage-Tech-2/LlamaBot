const { ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js')
const Utils = require('../util/Utils')

module.exports = class MakeCurrentButton {
  static getComponent () {
    return new ButtonBuilder()
      .setCustomId(this.getName())
      .setLabel('Make Current')
      .setStyle(ButtonStyle.Primary)
  }

  static getName () {
    return 'makecurrent'
  }

  static async execute (interaction, bot) {
    if (
      !Utils.isOwner(interaction) &&
      !Utils.hasPerms(interaction)
    ) {
      Utils.replyEphemeral(interaction, 'You do not have permission to use this!')
    }
    const guildId = interaction.guildId
    const guildHolder = bot.guilds.get(guildId)

    const submissionId = interaction.channelId
    const submission = await guildHolder.getSubmission(submissionId)
    if (!submission) {
      Utils.replyEphemeral(interaction, 'Submission not found')
      return
    }

    const revisions = submission.submissionData.revisions
    if (!revisions) {
      Utils.replyEphemeral(interaction, 'No revisions to move')
      return
    }

    const revisionId = interaction.message.id
    if (revisionId === submission.submissionData.currentRevision) {
      return
    }

    const revisionData = await submission.getRevision(revisionId)
    if (!revisionData) {
      console.error('Revision not found', revisionId)
      return
    }

    const oldRevisionData = await submission.getRevision(submission.submissionData.currentRevision)
    if (!oldRevisionData) {
      console.error('Current revision not found', submission.submissionData.currentRevision)
      return
    }

    const channel = await guildHolder.guild.channels.fetch(submission.forumThreadId)
    if (!channel) {
      throw new Error('Channel not found')
    }
    const originalMessage = await channel.messages.fetch(submission.submissionData.currentRevision)
    if (!originalMessage) {
      throw new Error('Original message not found')
    }
    const [originalEmbed, originalRow] = await submission.ReviewEmbed(oldRevisionData.data, false)
    await originalMessage.edit({
      embeds: [originalEmbed],
      components: [originalRow],
      flags: MessageFlags.SuppressNotifications
    })

    const message = await channel.messages.fetch(revisionId)
    if (!message) {
      throw new Error('Revision message not found')
    }
    const [embed, row] = await submission.ReviewEmbed(revisionData.data, true)
    await message.edit({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.SuppressNotifications
    })
    submission.submissionData.currentRevision = revisionId
    submission.save()

    await interaction.reply({
      content: `<@${interaction.user.id}> moved current revision to ${message.url}`
    })

    submission.updateStarterMessage(guildHolder)
  }
}
