const Utils = require('../util/Utils')
const { StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder, MessageFlags } = require('discord.js')
const SetImage = require('./setimage')

module.exports = class SetTags {
  static async getComponent (isMod, guildHolder, submission) {
    const channel = await guildHolder.guild.channels.fetch(submission.submissionData.archiveChannel)
    const tags = channel.availableTags.filter(tag => {
      return !tag.moderated || isMod || currentTags.includes(tag.name)
    })
    if (!tags.length) {
      tags.push({
        id: 'none',
        name: 'No tags available'
      })
    }
    const currentTags = submission.submissionData.tags || []
    return new StringSelectMenuBuilder()
      .setCustomId(this.getName())
      .setMinValues(0)
      .setMaxValues(Math.min(tags.length, 25))
      .setPlaceholder('Select tags')
      .addOptions(
        Array.from(tags).map(tag => {
          const opt = new StringSelectMenuOptionBuilder().setLabel(tag.name)
            .setValue(tag.name)
            .setDefault(currentTags.includes(tag.name))
          if (tag.emoji?.name) {
            opt.setEmoji({ name: tag.emoji.name })
          }
          return opt
        })
      )
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
      return
    }

    const guildId = interaction.guildId
    const guildHolder = bot.guilds.get(guildId)

    const submissionId = interaction.channelId
    const submission = await guildHolder.getSubmission(submissionId)
    if (!submission) {
      Utils.replyEphemeral(interaction, 'Submission not found')
    }

    const channel = await guildHolder.guild.channels.fetch(submission.submissionData.archiveChannel)
    if (!channel) {
      Utils.replyEphemeral(interaction, 'Archive channel not found')
      return
    }

    const currentTags = new Set(submission.submissionData.tags || [])
    const newTags = new Set(interaction.values)
    newTags.delete('No tags available')

    if (!Utils.hasPerms(interaction)) {
      const tagsAdmin = new Set(channel.availableTags.filter(tag => {
        return tag.moderated
      }).map(tag => tag.name))
      tagsAdmin.forEach(tag => {
        newTags.delete(tag)
      })
      currentTags.forEach(tag => {
        if (tagsAdmin.has(tag)) {
          newTags.add(tag)
        }
      })
    }
    const added = Array.from(newTags.difference(currentTags))
    const removed = Array.from(currentTags.difference(newTags))
    if (added.length || removed.length) {
      submission.submissionData.tags = Array.from(newTags)
      submission.save()
    }
    const str = []

    if (added.length) {
      str.push('added ' + added.join(', '))
    }

    if (removed.length) {
      str.push('removed ' + removed.join(', '))
    }

    if (str.length) {
      await interaction.reply(`<@${interaction.user.id}> ${str.join(' and ')} to tags`)
      submission.updateStarterMessage(guildHolder)
    }

    if (str.length && currentTags.size === 0 && !submission.submissionData.image) {
      const row = new ActionRowBuilder()
        .addComponents(await SetImage.getComponent(guildHolder, submission))
      await interaction.followUp({
        content: `<@${interaction.user.id}> Please set a main image`,
        components: [row],
        flags: MessageFlags.Ephemeral
      })
    }

    submission.reviewStageCheck(guildHolder)
  }
}
