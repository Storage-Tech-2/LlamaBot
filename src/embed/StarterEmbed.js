const { EmbedBuilder, ActionRowBuilder } = require('discord.js')
const SetChannelButton = require('../buttons/setchannel')
const SetTagsButton = require('../buttons/settags')
const SetImageButton = require('../buttons/setimage')
const SetAttachmentsButton = require('../buttons/setattachments')
module.exports = async function StarterEmbed (submissionData) {
  const embed = new EmbedBuilder()
  embed.setColor('#0099ff')
  embed.setTitle('Submission Status')
  let description = 'Thank you for submitting your work! Before we can publish your submission, the following needs to be completed:'
  description += '\n\n**Submission Progress**\n'
  if (submissionData.archiveChannel) {
    description += `:white_check_mark: Chose a channel: <#${submissionData.archiveChannel}>\n`
  } else {
    description += ':one: Choose a channel\n'
  }

  if (submissionData.tags) {
    description += `:white_check_mark: Chose tags: ${submissionData.tags.length ? submissionData.tags.join(', ') : 'No tags'}\n`
  } else {
    description += ':two: Choose tags\n'
  }

  if (submissionData.image) {
    description += `:white_check_mark: Chose main image: ${submissionData.image.name}\n`
  } else {
    description += ':three: Choose main image\n'
  }

  if (submissionData.attachments) {
    description += `:white_check_mark: Finalized attachments: ${submissionData.attachments.length ? submissionData.attachments.map(o => o.name).join(', ') : 'No attachments'}\n`
  } else {
    description += ':four: Finalize attachments\n'
  }

  description += `${submissionData.review ? ':white_check_mark:' : ':five:'} Review information\n`
  description += `${submissionData.voting ? ':white_check_mark:' : ':six:'} Voting\n`
  description += `${submissionData.published ? ':tada:' : ':seven:'} Publishing\n`

  description += `\nLast updated: <t:${Math.floor(Date.now() / 1000)}:F>`

  // Link to the latest version of the submission
  if (submissionData.url) {
    description += `\n\n[View latest version](${submissionData.url})`
  }

  embed.setDescription(description)

  // Post

  const row = new ActionRowBuilder()
    .addComponents(await SetChannelButton.getComponent(!!submissionData.archiveChannel))

  if (submissionData.archiveChannel) {
    row.addComponents(await SetTagsButton.getComponent(!!submissionData.tags))

    if (submissionData.tags) {
      row.addComponents(await SetImageButton.getComponent(!!submissionData.image))

      if (submissionData.image) {
        row.addComponents(await SetAttachmentsButton.getComponent(!!submissionData.attachments))
      }
    }
  }

  return [embed, row]
}
