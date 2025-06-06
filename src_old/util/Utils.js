const { PermissionFlagsBits, MessageFlags } = require('discord.js')

const DATA_VERSION_TO_RELEASE = Object.freeze({
  /* 1.21 line */
  4325: '1.21.5',
  4189: '1.21.4',
  4082: '1.21.3',
  4080: '1.21.2',
  3955: '1.21.1',
  3953: '1.21',

  /* 1.20 line */
  3839: '1.20.6',
  3837: '1.20.5',
  3700: '1.20.4',
  3698: '1.20.3',
  3578: '1.20.2',
  3465: '1.20.1',
  3463: '1.20',

  /* 1.19 line */
  3337: '1.19.4',
  3218: '1.19.3',
  3120: '1.19.2',
  3105: '1.19',

  /* 1.18 line */
  2975: '1.18.2',
  2865: '1.18.1',
  2860: '1.18',

  /* 1.17 line */
  2730: '1.17.1',
  2724: '1.17',

  /* 1.16 line */
  2586: '1.16.5',
  2584: '1.16.4',
  2580: '1.16.3',
  2578: '1.16.2',
  2567: '1.16.1',
  2566: '1.16',

  /* 1.15 line */
  2230: '1.15.2',
  2227: '1.15.1',
  2225: '1.15',

  /* 1.14 line */
  1976: '1.14.4',
  1968: '1.14.3',
  1963: '1.14.2',
  1957: '1.14.1',
  1952: '1.14',

  /* 1.13 line */
  1631: '1.13.2',
  1628: '1.13.1',
  1519: '1.13',

  /* 1.12 line */
  1343: '1.12.2',
  1241: '1.12.1',
  1139: '1.12',

  /* 1.11 line */
  922: '1.11.2',
  921: '1.11.1',
  819: '1.11',

  /* 1.10 line */
  512: '1.10.2',
  511: '1.10.1',
  510: '1.10',

  /* 1.9 line */
  184: '1.9.4',
  183: '1.9.3',
  176: '1.9.2',
  175: '1.9.1',
  169: '1.9'
})

module.exports = class Utils {
  static formatTime (d) {
    const seconds = d % 60
    let minutes = Math.floor(d / 60)

    let hours = Math.floor(minutes / 60)
    let days = Math.floor((hours / 24) * 10) / 10
    if (days < 1) days = 0
    hours = hours % 24
    minutes = minutes % 60

    const years = Math.floor(days / 365)
    days = days % 365

    if (years) {
      return years + ' year' + (years === 1 ? '' : 's') + ' ' + days + ' day' + (days === 1 ? '' : 's')
    } else
    if (days) {
      return days + ' day' + (days === 1 ? '' : 's')
    } else
    if (hours) {
      return hours + ':' + (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds
    } else if (minutes) {
      return minutes + ':' + (seconds < 10 ? '0' : '') + seconds
    } else {
      return seconds + 's'
    }
  }

  static replyEphemeral (interaction, content, options = {}) {
    if (!interaction.replied) {
      return interaction.reply({
        ...options,
        content: content,
        flags: MessageFlags.Ephemeral
      })
    } else {
      return interaction.followUp({
        ...options,
        content: content,
        flags: MessageFlags.Ephemeral
      })
    }
  }

  static isOwner (interaction) {
    if (!interaction.member || !interaction.channel) {
      return false
    }
    if (interaction.channel.ownerId === interaction.member.id) {
      return true
    }
    return false
  }

  static hasPerms (interaction) {
    if (!interaction.member) {
      return false
    }
    if (interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return true
    }
    return false
  }

  static compareVersion (ver1, ver2) {
    ver1 = ver1.split('.').map(s => s.padStart(10)).join('.')
    ver2 = ver2.split('.').map(s => s.padStart(10)).join('.')
    return ver1 <= ver2
  }

  static async getAllAttachments (channel) {
    return channel.messages.fetch({ limit: 100 }).then(messages => {
      const attachments = []
      messages.forEach(message => {
        if (message.author.bot) {
          return
        }
        if (message.content.length > 0) {
          // Find all URLs in the message
          const urls = message.content.match(/https?:\/\/[^\s]+/g)
          if (urls) {
            urls.forEach(url => {
              // Check if mediafire
              // https://www.mediafire.com/file/idjbw9lc1kt4obj/1_17_Crafter-r2.zip/file
              if (url.startsWith('https://www.mediafire.com/file/')) {
                const id = url.split('/')[4]
                const name = url.split('/')[5]
                attachments.push({
                  id: id,
                  name: name,
                  contentType: 'mediafire',
                  url: url,
                  __description: `[MediaFire] Sent by ${message.author.username} at ${message.createdAt.toLocaleString()}`
                })
              } else if (url.startsWith('https://cdn.discordapp.com/attachments/')) {
              // https://cdn.discordapp.com/attachments/749137321710059542/912059917106548746/Unbreakable_8gt_reset_6gt_box_replacement.litematic?ex=6832c4bd&is=6831733d&hm=1e5ff51ca94199d70f26ad2611715c86afbb095e3da120416e55352ccf43f7a4&
                const id = url.split('/')[5]
                const name = url.split('/')[6].split('?')[0]
                attachments.push({
                  id: id,
                  name: name,
                  contentType: 'discord',
                  url: url,
                  __description: `[DiscordCDN] Sent by ${message.author.username} at ${message.createdAt.toLocaleString()}`
                })
              }
            })
          }
        }
        if (message.attachments.size > 0) {
          message.attachments.forEach(attachment => {
            attachment.__description = `Sent by ${message.author.username} at ${message.createdAt.toLocaleString()}`
            attachments.push(attachment)
          })
        }
      })
      return attachments
    })
  }

  static dataVersionToMinecraftVersion (dataVersion) {
    if (dataVersion in DATA_VERSION_TO_RELEASE) {
      return DATA_VERSION_TO_RELEASE[dataVersion]
    } else {
      // find closest below and above
      let closestBelow = null
      let closestAbove = null
      for (const version of Object.keys(DATA_VERSION_TO_RELEASE)) {
        if (version < dataVersion) {
          if (!closestBelow || version > closestBelow) {
            closestBelow = version
          }
        } else if (version > dataVersion) {
          if (!closestAbove || version < closestAbove) {
            closestAbove = version
          }
        }
      }
      if (closestBelow && closestAbove) {
        return `${DATA_VERSION_TO_RELEASE[closestBelow]} - ${DATA_VERSION_TO_RELEASE[closestAbove]}`
      } else if (closestBelow) {
        return DATA_VERSION_TO_RELEASE[closestBelow]
      } else if (closestAbove) {
        return DATA_VERSION_TO_RELEASE[closestAbove]
      } else {
        return 'Unknown'
      }
    }
  }
}
