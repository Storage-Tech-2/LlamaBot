const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js')
const Utils = require('../util/Utils')
const SetTags = require('../menus/settags')

module.exports = class SetTagsButton {
  static getComponent (set) {
    return new ButtonBuilder()
      .setCustomId(this.getName())
      .setLabel(set ? 'Change Tags' : 'Set Tags')
      .setStyle(set ? ButtonStyle.Secondary : ButtonStyle.Primary)
  }

  static getName () {
    return 'settags'
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

    const row = new ActionRowBuilder()
      .addComponents(await SetTags.getComponent(Utils.hasPerms(interaction), guildHolder, submission))
    await Utils.replyEphemeral(interaction, `<@${interaction.user.id}> Please select tags`, {
      components: [row]
    })
  }
}
