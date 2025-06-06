const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js')
const Utils = require('../util/Utils')
const SetCategory = require('../menus/setcategory')

module.exports = class SetChannelButton {
  static getComponent (set) {
    return new ButtonBuilder()
      .setCustomId(this.getName())
      .setLabel(set ? 'Change Channel' : 'Set Channel')
      .setStyle(set ? ButtonStyle.Secondary : ButtonStyle.Primary)
  }

  static getName () {
    return 'setchannel'
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

    const row = new ActionRowBuilder()
      .addComponents(await SetCategory.getComponent(guildHolder))
    await Utils.replyEphemeral(interaction, `<@${interaction.user.id}> Please select an archive category`, {
      components: [row]
    })
  }
}
