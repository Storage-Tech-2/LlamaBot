const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js')
const Utils = require('../util/Utils')
const SetAttachments = require('../menus/setattachments')

module.exports = class SetAttachmentsButton {
  static getComponent (set) {
    return new ButtonBuilder()
      .setCustomId(this.getName())
      .setLabel(set ? 'Change Attachments' : 'Set Attachments')
      .setStyle(set ? ButtonStyle.Secondary : ButtonStyle.Primary)
  }

  static getName () {
    return 'setattachments'
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
      .addComponents(await SetAttachments.getComponent(guildHolder, submission))
    await Utils.replyEphemeral(interaction, `<@${interaction.user.id}> Please select Schematics/WDLS`, {
      components: [row]
    })
  }
}
