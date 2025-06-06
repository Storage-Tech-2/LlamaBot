const Utils = require('../util/Utils')
const { ChannelType, ChannelSelectMenuBuilder } = require('discord.js')

module.exports = class SetArchives {
  static async getComponent (currentChannels, guildHolder) {
    const channels = await guildHolder.guild.channels.fetch()
    // Filter for category channels
    const categoryChannels = channels.filter(channel => channel.type === ChannelType.GuildCategory)
    return new ChannelSelectMenuBuilder()
      .setCustomId('setarchives')
      .setMinValues(0)
      .setMaxValues(Math.min(categoryChannels.size, 25))
      .setPlaceholder('Select archive categories')
      .setChannelTypes(ChannelType.GuildCategory)
      .setDefaultChannels(currentChannels)
  }

  static getName () {
    return 'setarchives'
  }

  static execute (interaction, bot) {
    if (!Utils.hasPerms(interaction, bot)) {
      Utils.replyEphemeral(interaction, 'You do not have permission to use this command')
      return
    }

    const guildId = interaction.guildId
    const guildHolder = bot.guilds.get(guildId)
    const currentCategories = new Set(guildHolder.getConfig('archive_categories') || [])
    const newCategories = new Set(interaction.values || [])
    const added = Array.from(newCategories.difference(currentCategories)).map(c => `<#${c}>`)
    const removed = Array.from(currentCategories.difference(newCategories)).map(c => `<#${c}>`)
    guildHolder.setConfig('archive_categories', Array.from(newCategories))

    const str = []

    if (added.length) {
      str.push('added ' + added.join(', '))
    }

    if (removed.length) {
      str.push('removed ' + removed.join(', '))
    }

    if (str.length) {
      interaction.reply(`<@${interaction.user.id}> ${str.join(' and ')} to archive categories`)
    }
  }
}
