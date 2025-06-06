const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js')
const Utils = require('../util/Utils')
const SetImage = require('../menus/setimage')

module.exports = class SetImageButton {
  static getComponent (set) {
    return new ButtonBuilder()
      .setCustomId(this.getName())
      .setLabel(set ? 'Change Image' : 'Set Image')
      .setStyle(set ? ButtonStyle.Secondary : ButtonStyle.Primary)
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
    }
    const guildId = interaction.guildId
    const guildHolder = bot.guilds.get(guildId)
    const submissionId = interaction.channelId
    const submission = await guildHolder.getSubmission(submissionId)

    const row = new ActionRowBuilder()
      .addComponents(await SetImage.getComponent(guildHolder, submission))
    await Utils.replyEphemeral(interaction, `<@${interaction.user.id}> Please set a main image`, {
      components: [row]
    })
  }
}
