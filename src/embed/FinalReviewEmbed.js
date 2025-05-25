const { EmbedBuilder, AttachmentBuilder } = require('discord.js')

module.exports = async function FinalReviewEmbed (submission, revision) {
  const submissionData = submission.submissionData
  const embed = new EmbedBuilder()

  const files = []
  if (submissionData?.image?.processed) {
    const file = new AttachmentBuilder(submissionData.image.processed)
    embed
      .setImage('attachment://processed.png')
    files.push(file)
  }

  embed.setColor('#0099ff')
  embed.setTitle('Final Submission')
  let description = ''
  description += `## [${revision?.game_version || 'N/A'}] ${revision?.name || 'No Name'}\n`

  description += `**Authors:** ${revision?.authors?.join(', ')}\n`

  description += `**Description:** ${revision?.description}`

  if (revision?.features?.length) {
    description += '\n\n**Features**'
    revision.features.forEach((feature) => {
      description += `\n- ${feature}`
    })
  }

  if (revision?.cons?.length) {
    description += '\n\n**Considerations**'
    revision.cons.forEach((con) => {
      description += `\n- ${con}`
    })
  }

  if (revision?.notes?.length) {
    description += '\n\n**Notes**\n'
    description += revision.notes
  }

  embed.setDescription(description)

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

  embed.setTimestamp()
  embed.setFooter({ text: `Submission ID: ${submission.forumThreadId}` })

  return [embed, files]
}
