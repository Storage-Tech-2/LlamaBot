const { ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js')
const Utils = require('../util/Utils')

module.exports = class FinalizeButton {
  static getComponent (disabled = false) {
    return new ButtonBuilder()
      .setCustomId(this.getName())
      .setLabel('Finalize')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  }

  static getName () {
    return 'finalize'
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
    }

    const revision = await submission.getRevision(interaction.message.id)
    if (!revision) {
      Utils.replyEphemeral(interaction, 'Revision not found')
      return
    }

    const [embed, row] = await submission.ReviewEmbed(revision.data, revision.id === submission.submissionData.currentRevision, true)

    await interaction.message.edit({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.SuppressNotifications
    })

    await interaction.reply({
      content: `<@${interaction.user.id}> Finalized ${interaction.message.url}`
    })

    submission.advanceToVotingStage(guildHolder)
  }
}
