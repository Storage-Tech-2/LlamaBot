const { EmbedBuilder, ActionRowBuilder } = require('discord.js')
const EditSubmissionButton = require('../buttons/editsubmission')
const MakeCurrentButton = require('../buttons/makecurrent')
const FinalizeButton = require('../buttons/finalize')

module.exports = async function ReviewEmbed (revision, isCurrent, finalized = false) {
  // const submissionData = submission.submissionData
  const embed = new EmbedBuilder()

  // const files = []
  //   if (submissionData?.image?.processed) {
  //     const file = new AttachmentBuilder(submissionData.image.processed)
  //     embed
  //       .setImage('attachment://processed.png')
  //     files.push(file)
  //   }

  embed.setColor(isCurrent ? '#0099ff' : '#ff9900')
  embed.setTitle(`Submission Draft${isCurrent ? ' (Current)' : ''}`)
  let description = ''
  description += `## [${revision?.game_version || 'N/A'}] ${revision?.name || 'No Name'}\n`

  description += `**Authors:** ${revision?.authors?.join(', ')}\n`

  description += `**Description:** ${revision?.description}`

  if (revision?.features?.length) {
    description += '\n\n**Features**\n'
    revision.features.forEach((feature) => {
      description += `- ${feature}\n`
    })
  }

  if (revision?.cons?.length) {
    description += '\n\n**Considerations**\n'
    revision.cons.forEach((con) => {
      description += `- ${con}\n`
    })
  }

  if (revision?.notes?.length) {
    description += '\n\n**Notes**\n'
    description += revision.notes
  }

  //   if (submissionData?.attachments?.length) {
  //     const schematics = []
  //     const others = []
  //     submissionData.attachments.forEach((attachment) => {
  //       const ext = attachment.name.split('.').pop()
  //       if (ext === 'litematic' && attachment.key) {
  //         schematics.push(attachment)
  //       } else {
  //         others.push(attachment)
  //       }
  //     })
  //     if (schematics.length) {
  //       description += '\n**Schematics**\n'
  //       schematics.forEach((attachment) => {
  //         // const path = Path.join(submission.folderPath, 'attachments', attachment.key)
  //         // const file = new AttachmentBuilder(path)
  //         // file.setName(attachment.name)
  //         // files.push(file)
  //         description += `- ${attachment.name} (MC ${attachment.version}): ${attachment.size}\n`
  //       })
  //     }

  //     if (others.length) {
  //       description += '\n**Other Attachments**\n'
  //       others.forEach((attachment) => {
  //         if (attachment.key) {
  //         //   const path = Path.join(submission.folderPath, 'attachments', attachment.key)
  //         //   const file = new AttachmentBuilder(path)
  //         //   file.setName(attachment.name)
  //         //   files.push(file)
  //           description += `- ${attachment.name} (${attachment.contentType})\n`
  //         } else {
  //           description += `- [${attachment.name}](${attachment.url}) (${attachment.contentType})\n`
  //         }
  //       })
  //     }
  //   }

  embed.setDescription(description)

  embed.setFooter({
    text: 'This is a draft submission. Reply to this message with instructions to update it.'
  })

  const row = new ActionRowBuilder()
    .addComponents(await EditSubmissionButton.getComponent())

  if (!isCurrent) {
    row.addComponents(await MakeCurrentButton.getComponent())
  } else {
    row.addComponents(await FinalizeButton.getComponent(finalized))
  }

  return [embed, row]
}
