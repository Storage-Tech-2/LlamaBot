const { InteractionContextType, SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ForumLayoutType, SortOrderType } = require('discord.js')
const Utils = require('../util/Utils.js')
const SetArchives = require('../menus/setarchives.js')
module.exports = class MCOCommand {
  static getData () {
    return new SlashCommandBuilder()
      .setName('mwa')
      .setDescription('Llamabot commands')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts(InteractionContextType.Guild)
      .addSubcommand(subcommand =>
        subcommand
          .setName('setsubmissions')
          .setDescription('Setup Llamabot to listen to a channel')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Channel to listen to')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildForum)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('setpolls')
          .setDescription('Setup Llamabot to send polls to a channel')
          .addChannelOption(option =>
            option
              .setName('channel')
              .setDescription('Channel to send polls to')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildForum)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('setarchives')
          .setDescription('Setup archive channels for Llamabot')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('addtags')
          .setDescription('Setup basic tags for archive channels')
      )
  }

  static async setSubmissions (interaction, bot) {
    const channel = interaction.options.getChannel('channel')
    if (!channel) {
      await Utils.replyEphemeral(interaction, 'Invalid channel')
      return
    }

    const guildHolder = bot.guilds.get(interaction.guildId)
    guildHolder.setConfig('submissions_channel', channel.id)
    await Utils.replyEphemeral(interaction, `Llamabot will now listen to ${channel.name}`)
  }

  static async setArchives (interaction, bot) {
    // Get all channels in the guild
    const guildHolder = bot.guilds.get(interaction.guildId)
    const currentCategories = guildHolder.getConfig('archive_categories') || []
    const row = new ActionRowBuilder()
      .addComponents(await SetArchives.getComponent(currentCategories, guildHolder))
      // interaction.reply({ content: `Change notification settings of '${name}' in this channel`, components: [row], ephemeral: true })
    await Utils.replyEphemeral(interaction, 'Select archive categories', { components: [row] })
  }

  static async setPolls (interaction, bot) {
    const channel = interaction.options.getChannel('channel')
    if (!channel) {
      await Utils.replyEphemeral(interaction, 'Invalid channel')
      return
    }

    const guildHolder = bot.guilds.get(interaction.guildId)
    guildHolder.setConfig('polls_channel', channel.id)
    await Utils.replyEphemeral(interaction, `Llamabot will now send polls to ${channel.name}`)
  }

  static async addTags (interaction, bot) {
    const guildHolder = bot.guilds.get(interaction.guildId)
    const currentCategories = guildHolder.getConfig('archive_categories') || []
    // get all channels in categories
    const allchannels = await guildHolder.guild.channels.fetch()
    const channels = allchannels.filter(channel => channel.type === ChannelType.GuildForum && currentCategories.includes(channel.parentId))

    const basicTags = [
      {
        name: 'Untested',
        emoji: { name: '⁉️' }
      },
      {
        name: 'Broken',
        emoji: { name: '💔' }
      },
      {
        name: 'Tested & Functional',
        emoji: { name: '✅' }
      },
      {
        name: 'Quite Novel',
        emoji: { name: '😋' },
        moderated: true
      },
      {
        name: 'A+ Excellent',
        emoji: { name: '⭐' },
        moderated: true
      }
    ]
    // check each channel

    await interaction.deferReply()
    for (const channel of channels.values()) {
      const tags = channel.availableTags.filter(tag => {
        return !basicTags.some(t => t.name === tag.name)
      })
      const newTags = basicTags.concat(tags)
      await channel.setAvailableTags(newTags)
      await channel.setDefaultReactionEmoji({ name: '👍' })
      await channel.setDefaultForumLayout(ForumLayoutType.GalleryView)
      await channel.setDefaultSortOrder(SortOrderType.CreationDate)
    }
    await interaction.editReply('Tags added to all channels')
  }

  static async execute (interaction, bot) {
    if (interaction.options.getSubcommand() === 'setsubmissions') {
      this.setSubmissions(interaction, bot)
    } else if (interaction.options.getSubcommand() === 'setarchives') {
      this.setArchives(interaction, bot)
    } else if (interaction.options.getSubcommand() === 'setpolls') {
      this.setPolls(interaction, bot)
    } else if (interaction.options.getSubcommand() === 'addtags') {
      this.addTags(interaction, bot)
    }
  }
}
