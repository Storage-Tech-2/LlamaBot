const Utils = require('../util/Utils')
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js')

module.exports = class EditModal {
  static async getComponent (revision) {
    const revisionData = revision.data
    const modal = new ModalBuilder()
      .setCustomId(this.getName() + '|' + revision.id)
      .setTitle('Edit Submission')

    const nameInput = new TextInputBuilder()
      .setCustomId('nameInput')
      .setLabel('Name of the device')
      .setStyle(TextInputStyle.Short)
      .setValue(revisionData.name)
      .setRequired(true)

    const versionInput = new TextInputBuilder()
      .setCustomId('gameVersionInput')
      .setLabel('Game version of the device')
      .setStyle(TextInputStyle.Short)
      .setValue(revisionData.game_version)
      .setRequired(true)

    const authorsInput = new TextInputBuilder()
      .setCustomId('authorsInput')
      .setLabel('Authors of the device')
      .setStyle(TextInputStyle.Short)
      .setValue((revisionData.authors || []).join(', '))
      .setRequired(true)

    const row1 = new ActionRowBuilder().addComponents(nameInput)
    const row2 = new ActionRowBuilder().addComponents(versionInput)
    const row3 = new ActionRowBuilder().addComponents(authorsInput)
    modal.addComponents(row1, row2, row3)
    return modal
  }

  static getName () {
    return 'editmodal'
  }

  static async execute (interaction, bot, revisionID) {
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
    const revision = await submission.getRevision(revisionID)
    if (!revision) {
      Utils.replyEphemeral(interaction, 'Revision not found')
      return
    }

    const nameInput = interaction.fields.getTextInputValue('nameInput')
    const versionInput = interaction.fields.getTextInputValue('gameVersionInput')
    const authorsInput = interaction.fields.getTextInputValue('authorsInput')
    const authors = authorsInput.split(',').map(o => o.trim()).filter(o => o !== '')

    await interaction.reply({
      content: `<@${interaction.user.id}> Manually edited the submission`
    })

    const revisionData = {
      name: nameInput,
      game_version: versionInput,
      authors: authors
    }
  }
}
