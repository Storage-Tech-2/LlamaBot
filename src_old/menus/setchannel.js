const Utils = require('../util/Utils')
const { ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder, MessageFlags } = require('discord.js')
const SetTags = require('./settags')

module.exports = class SetChannel {
  static async getComponent (category, guildHolder, submission) {
    const channels = await guildHolder.guild.channels.fetch()
    // Filter for category channels
    const categoryChannels = channels.filter(channel => channel.type === ChannelType.GuildForum && channel.parentId === category)

    return new StringSelectMenuBuilder()
      .setCustomId(this.getName())
      .setMinValues(1)
      .setMaxValues(1)
      .setPlaceholder('Select archive channel')
      .addOptions(
        Array.from(categoryChannels.values()).map(channel => {
          return new StringSelectMenuOptionBuilder().setLabel(channel.name)
            .setValue(channel.id)
            .setDefault(submission.submissionData.archiveChannel === channel.id)
        })
      )
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

    const newChannel = interaction.values[0]
    const currentChannel = submission.submissionData.archiveChannel
    if (currentChannel === newChannel) {
      return
    }
    submission.submissionData.archiveChannel = newChannel
    submission.save()

    if (!currentChannel) {
      await interaction.reply(`<@${interaction.user.id}> set archive channel to <#${newChannel}>`)
    } else {
      await interaction.reply(`<@${interaction.user.id}> changed archive channel from <#${currentChannel}> to <#${newChannel}>`)
    }

    // Migrate tags
    if (submission.submissionData.tags) {
      const channel = await guildHolder.guild.channels.fetch(newChannel)
      const tags = channel.availableTags.map(tag => tag.name)
      const currentTags = new Set(submission.submissionData.tags || [])
      const newTags = new Set(tags)

      const migratedTags = Array.from(currentTags.intersection(newTags))
      const removedTags = Array.from(currentTags.difference(newTags))
      submission.submissionData.tags = migratedTags
      submission.save()
      if (removedTags.length) {
        await interaction.followUp(`Not all tags were migrated, the following tags were removed because they are not available in the new channel: ${removedTags.join(', ')}`)
      }
    }
    submission.updateStarterMessage(guildHolder)

    if (!currentChannel) {
      const row = new ActionRowBuilder()
        .addComponents(await SetTags.getComponent(Utils.hasPerms(interaction), guildHolder, submission))
      await interaction.followUp({
        content: `<@${interaction.user.id}> Please select tags`,
        components: [row],
        flags: MessageFlags.Ephemeral
      })
    }

    submission.reviewStageCheck(guildHolder)
  }
}
