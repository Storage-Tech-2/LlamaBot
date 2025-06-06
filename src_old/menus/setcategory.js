const Utils = require('../util/Utils')
const { ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require('discord.js')
const SetChannel = require('./setchannel')

module.exports = class SetCategory {
  static async getComponent (guildHolder) {
    const channels = await guildHolder.guild.channels.fetch()
    // Filter for category channels
    const categoryChannels = channels.filter(channel => channel.type === ChannelType.GuildCategory && guildHolder.getConfig('archive_categories').includes(channel.id))

    return new StringSelectMenuBuilder()
      .setCustomId(this.getName())
      .setMinValues(1)
      .setMaxValues(1)
      .setPlaceholder('Select archive category')
      .addOptions(
        Array.from(categoryChannels.values()).map(channel => {
          return new StringSelectMenuOptionBuilder().setLabel(channel.name)
            .setValue(channel.id)
        })
      )
  }

  static getName () {
    return 'setcategory'
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
    }

    const newCategory = interaction.values[0]
    const row = new ActionRowBuilder()
      .addComponents(await SetChannel.getComponent(newCategory, guildHolder, submission))
    await Utils.replyEphemeral(interaction, `<@${interaction.user.id}> Please select an archive channel`, {
      components: [row]
    })
    //
  }
}
