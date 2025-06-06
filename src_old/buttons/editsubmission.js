const { ButtonBuilder, ButtonStyle } = require('discord.js')
const Utils = require('../util/Utils')
const EditModal = require('../modals/editmodal')

module.exports = class EditSubmissionButton {
  static getComponent () {
    return new ButtonBuilder()
      .setCustomId(this.getName())
      .setLabel('Edit Submission')
      .setStyle(ButtonStyle.Primary)
  }

  static getName () {
    return 'editsubmission'
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

    await interaction.showModal(await EditModal.getComponent(revision))
  }
}
