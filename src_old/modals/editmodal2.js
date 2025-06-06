const Utils = require('../util/Utils')
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js')

module.exports = class EditModal2 {
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

    const descriptionInput = new TextInputBuilder()
      .setCustomId('descriptionInput')
      .setLabel('Description of the device')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(revisionData.description)
      .setRequired(true)

    const featuresAndConsInput = new TextInputBuilder()
      .setCustomId('featuresAndConsInput')
      .setLabel('Features and Cons of the device')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(`## Features\n${revisionData.features.map(o => '- ' + o.trim()).join('\n')}\n\n## Considerations\n${(revisionData.cons || []).map(o => '- ' + o.trim()).join('\n')}\n\n## Notes\n${(revisionData.notes || '').trim()}`)
      .setRequired(true)

    const row1 = new ActionRowBuilder().addComponents(nameInput)
    const row2 = new ActionRowBuilder().addComponents(versionInput)
    const row3 = new ActionRowBuilder().addComponents(authorsInput)
    const row4 = new ActionRowBuilder().addComponents(descriptionInput)
    const row5 = new ActionRowBuilder().addComponents(featuresAndConsInput)
    modal.addComponents(row1, row2, row3, row4, row5)
    return modal
  }

  static getName () {
    return 'editmodal2'
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
    const descriptionInput = interaction.fields.getTextInputValue('descriptionInput')
    const featuresAndConsInput = interaction.fields.getTextInputValue('featuresAndConsInput')
    const features = featuresAndConsInput.split('## Features')[1].split('## Considerations')[0].split('\n- ').map(o => o.trim()).filter(o => o !== '')
    const cons = featuresAndConsInput.split('## Considerations')[1].split('## Notes')[0].split('\n- ').map(o => o.trim()).filter(o => o !== '')
    const notes = featuresAndConsInput.split('## Notes')[1].split('\n').filter(o => o !== '').join('\n')

    await interaction.reply({
      content: `<@${interaction.user.id}> Manually edited the submission`
    })

    const revisionData = {
      name: nameInput,
      game_version: versionInput,
      authors: authors,
      description: descriptionInput,
      features: features,
      cons: cons,
      notes: notes
    }
    // await submission.saveRevision(revision)
    const shouldMoveRevision = revision.id === submission.submissionData.currentRevision
    const [newEmbed, newRow] = await submission.ReviewEmbed(revisionData, shouldMoveRevision)

    const originalMessage = await interaction.channel.messages.fetch(revision.id)
    const messageo = await interaction.followUp({
      embeds: [newEmbed],
      components: [newRow],
      flags: MessageFlags.SuppressNotifications
    })
    const newRevision = {
      id: messageo.id,
      timestamp: Date.now(),
      data: revisionData
    }
    submission.submissionData.revisions.push(messageo.id)
    if (shouldMoveRevision) {
      // edit the original message
      const [originalEmbed, originalRow] = await submission.ReviewEmbed((await submission.getRevision(submission.submissionData.currentRevision)).data, false)
      await originalMessage.edit({
        embeds: [originalEmbed],
        components: [originalRow],
        flags: MessageFlags.SuppressNotifications
      })
      submission.submissionData.currentRevision = newRevision.id
    }
    submission.saveRevision(newRevision)
    submission.save()
  }
}
