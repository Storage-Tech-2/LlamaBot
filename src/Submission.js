const fs = require('fs/promises')
const Path = require('path')
const LLMUtils = require('./util/LLMUtils')
const { SubmissionStage } = require('./enum/SubmissionStage')
const StarterEmbed = require('./embed/StarterEmbed')
const { MessageFlags } = require('discord.js')
const ReviewEmbed = require('./embed/ReviewEmbed')
const Utils = require('./util/Utils')
const got = require('got')
const sharp = require('sharp')
const { Litematic } = require('./lib/litematic-reader/main.js')
module.exports = class Submission {
  constructor (forumThreadId, folderPath) {
    this.folderPath = folderPath
    this.forumThreadId = forumThreadId
    this.submissionData = {}
    this.lastAccessed = Date.now()
  }

  get ReviewEmbed () {
    return ReviewEmbed
  }

  async getRevision (revisionID) {
    const folderPath = Path.join(this.folderPath, 'revisions')
    const filePath = Path.join(folderPath, `${revisionID}.json`)
    const data = await fs.readFile(filePath, 'utf-8')
    const revisionData = JSON.parse(data)
    return revisionData
  }

  async saveRevision (revision) {
    const revisionID = revision.id
    const folderPath = Path.join(this.folderPath, 'revisions')
    await fs.mkdir(folderPath, { recursive: true })
    const filePath = Path.join(folderPath, `${revisionID}.json`)
    await fs.writeFile(filePath, JSON.stringify(revision, null, 2))
  }

  async save () {
    const folderPath = this.folderPath
    const filePath = Path.join(folderPath, 'submission.json')
    await fs.writeFile(filePath, JSON.stringify(this.submissionData, null, 2))
  }

  async load () {
    const folderPath = this.folderPath
    const filePath = Path.join(folderPath, 'submission.json')
    const data = await fs.readFile(filePath, 'utf-8')
    this.submissionData = JSON.parse(data)
  }

  async init (guildHolder) {
    this.submissionData.stage = SubmissionStage.NEW
    this.submissionData.revisions = []
    this.check(guildHolder)
  }

  async check (guildHolder) {
    const channel = await guildHolder.guild.channels.fetch(this.forumThreadId)
    if (!channel) {
      throw new Error('Channel not found')
    }

    if (!this.submissionData.initialMessageId) {
      // post initial message
      const [initialEmbed, initialRow] = await StarterEmbed({})
      const message = await channel.send({ embeds: [initialEmbed], components: [initialRow] })
      message.pin()
      this.submissionData.initialMessageId = message.id
      this.save()
    }

    if (!this.llmPromiseResolved && !this.submissionData.revisions.length && !this.llmPromise) {
      // request llm response
      this.llmPromiseResolved = false
      this.llmPromise = this.useLLMExtract(guildHolder, channel)
        .then((llmResponse) => {
          this.llmPromiseResolved = true
          this.reviewStageCheck(guildHolder)
          return llmResponse
        })
        .catch((error) => {
          this.llmPromiseResolved = true
          console.error('Error using LLM:', error)
        })
    }
  }

  canJunk () {
    return (!this.llmPromise || this.llmPromiseResolved) && !this.llmRevisePromise
  }

  async useLLMExtract (guildHolder, channel) {
    // find starter message
    const message = await channel.fetchStarterMessage()
    if (!message) {
      throw new Error('No starter message found in channel')
    }
    // request llm response
    const llmPrompt = await LLMUtils.promptFromTemplate('extraction', {
      input: `**${channel.name}**\n${message.content}`
    })
    const llmResponse = await guildHolder.bot.addLLMRequest(llmPrompt)
    return llmResponse
  }

  async useLLMRevise (guildHolder, prompt, revision) {
    // find starter message
    const revisionMessage = JSON.stringify(revision, null, 2)
    // request llm response
    const llmPrompt = await LLMUtils.promptFromTemplate('modification', {
      prompt: prompt,
      input: revisionMessage
    })
    const llmResponse = await guildHolder.bot.addLLMRequest(llmPrompt)
    return llmResponse
  }

  async reviewStageCheck (guildHolder) {
    if (!this.submissionData.archiveChannel || !this.submissionData.tags || !this.submissionData.image || !this.submissionData.attachments) {
      return
    }

    if (this.submissionData.stage !== SubmissionStage.NEW) {
      return
    }

    console.log('Moving to review stage')

    this.submissionData.stage = SubmissionStage.REVIEW
    this.save()
    const channel = await guildHolder.guild.channels.fetch(this.forumThreadId)

    let response
    try {
      if (!this.llmPromiseResolved && this.llmPromise) {
        const msg = await channel.send('Waiting for LLM to respond...')
        response = await this.llmPromise
        msg.delete()
      } else {
        response = await this.llmPromise
      }
      this.llmPromise = null
      this.llmPromiseResolved = true
    } catch (error) {
      console.error('Error resolving LLM promise:', error)
      channel.send('Error using LLM, will fall back to manual review')
    }

    try {
      const [embed, row] = await ReviewEmbed(response, true)
      const message = await channel.send({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.SuppressNotifications
      })
      const revision = {
        id: message.id,
        timestamp: Date.now(),
        data: response
      }
      this.submissionData.revisions.push(message.id)
      this.submissionData.currentRevision = revision.id
      this.saveRevision(revision)
      this.save()
    } catch (error) {
      console.error('Error creating review embed:', error)
      channel.send('Error creating review embed, please check the logs')
    }
    this.updateStarterMessage(guildHolder)
  }

  async advanceToVotingStage (guildHolder) {
    if (this.submissionData.stage !== SubmissionStage.REVIEW) {
      return
    }
    // check if everything is set
    if (!this.submissionData.archiveChannel || !this.submissionData.tags || !this.submissionData.image || !this.submissionData.attachments) {
      return
    }

    this.submissionData.stage = SubmissionStage.VOTING

    const currentRevision = await this.getRevision(this.submissionData.currentRevision)
    if (!currentRevision) {
      console.error('Current revision not found')
      return
    }

    const channel = await guildHolder.guild.channels.fetch(this.forumThreadId)
    if (!channel) {
      throw new Error('Channel not found')
    }

    const archiveChannel = await guildHolder.guild.channels.fetch(this.submissionData.archiveChannel)
    if (!archiveChannel) {
      throw new Error('Archive channel not found')
    }

    const data = {
      name: currentRevision.data.name || '',
      archive_channel: {
        url: archiveChannel.url,
        id: this.submissionData.archiveChannel,
        name: archiveChannel.name
      },
      discussion_thread: {
        url: channel.url,
        id: channel.id,
        name: channel.name
      },
      tags: this.submissionData.tags,
      game_version: currentRevision.data.game_version,
      authors: currentRevision.data.authors.map(o => {
        o = o.trim()
        const obj = {}
        // check if pingable
        if (o.startsWith('<@') && o.endsWith('>')) {
          const id = o.substring(2, o.length - 1)
          const user = guildHolder.guild.members.cache.get(id)
          obj.id = id
          if (user) {
            obj.name = user.displayName
          }
        } else {
          obj.name = o
        }
        return obj
      }),
      description: currentRevision.data.description || '',
      features: (currentRevision.data.features || []).map(o => o.trim()),
      cons: (currentRevision.data.cons || []).map(o => o.trim()),
      notes: (currentRevision.data.notes || '').trim(),
      image: {
        name: this.submissionData.image.name,
        file: Path.basename(this.submissionData.image.processed)
      },
      attachments: this.submissionData.attachments.map(o => {
        const obj = {}
        obj.name = o.name
        if (o.key) {
          obj.file = o.key
          if (o.contentType === 'litematic') {
            obj.mc_version = o.version
            obj.size = o.size
          }
        } else {
          obj.url = o.url
        }
        obj.type = o.contentType
        return obj
      })
    }

    this.submissionData.final_data = data
    this.save()
  }

  async createPost (submissionData, revisionData) {

  }

  async processImage () {
    // Download images and attachments
    const mainImage = this.submissionData.image
    const ext = mainImage.contentType.split('/')[1]
    const imagePath = Path.join(this.folderPath, `image.${ext}`)
    const imageUrl = mainImage.url
    const image = await got(imageUrl, { responseType: 'buffer' })
    await fs.writeFile(imagePath, image.body)

    const processedImagePath = Path.join(this.folderPath, 'processed.png')
    await sharp(imagePath)
      .trim()
      .resize({
        width: 800,
        height: 800,
        fit: 'inside',
        withoutEnlargement: true
      })
      .toFormat('png')
      .toFile(processedImagePath)
    this.submissionData.image.processed = processedImagePath
  }

  async processAttachments () {
    const attachmentFolder = Path.join(this.folderPath, 'attachments')
    await fs.mkdir(attachmentFolder, { recursive: true })
    for (const attachment of this.submissionData.attachments) {
      const key = Path.basename(`${attachment.id}_${attachment.name}`)
      const attachmentPath = Path.join(attachmentFolder, key)
      const attachmentUrl = attachment.url
      if (attachment.contentType !== 'mediafire') {
        const attachmentFile = await got(attachmentUrl, { responseType: 'buffer' })
        await fs.writeFile(attachmentPath, attachmentFile.body)
        attachment.key = key
      }

      const ext = attachment.name.split('.').pop()
      if (ext === 'litematic') {
        try {
          const litematicFile = await fs.readFile(attachmentPath)
          const litematic = new Litematic(litematicFile)
          await litematic.read()

          const dataVersion = litematic.litematic.nbtData.MinecraftDataVersion
          const version = Utils.dataVersionToMinecraftVersion(dataVersion)
          const size = litematic.litematic.blocks
          const sizeString = `${size.maxx - size.minx + 1}x${size.maxy - size.miny + 1}x${size.maxz - size.minz + 1}`
          attachment.size = sizeString
          attachment.version = version
          attachment.contentType = 'litematic'
        } catch (error) {
          console.error('Error processing litematic file:', error)
          attachment.error = 'Error processing litematic file'
        }
      }
    }
  }

  async getAttachments (guildHolder) {
    if (this.attachments) {
      return this.attachments
    }
    const channel = await guildHolder.guild.channels.fetch(this.forumThreadId)
    const attachments = await Utils.getAllAttachments(channel)
    this.attachments = attachments

    setTimeout(() => {
      this.attachments = null
    }, 5000)

    return attachments
  }

  async updateStarterMessage (guildHolder) {
    const channel = await guildHolder.guild.channels.fetch(this.forumThreadId)
    if (!channel) {
      throw new Error('Channel not found')
    }

    const message = await channel.messages.fetch(this.submissionData.initialMessageId)
    if (!message) {
      throw new Error('Initial message not found')
    }

    if (this.submissionData.currentRevision) {
      const revisionMessage = await channel.messages.fetch(this.submissionData.currentRevision)
      this.submissionData.url = revisionMessage.url
    }
    const [initialEmbed, initialRow] = await StarterEmbed(this.submissionData)
    await message.edit({ embeds: [initialEmbed], components: [initialRow] })
  }

  async handleReplies (message, guildHolder) {
    // Make sure it isn't bot
    if (message.author.bot || !this.submissionData.revisions) {
      return
    }

    // Check if message id is in revisions
    if (!this.submissionData.revisions.includes(message.reference.messageId)) {
      return
    }

    // It's a reply to the bot for a revision
    const revision = await this.getRevision(message.reference.messageId)
    if (!revision) {
      console.error('Revision not found', message.reference.messageId)
      return
    }

    if (this.llmRevisePromise) {
      console.log('LLM revise promise already in progress')
      message.reply('Revision already in progress, please wait')
      return
    }

    const wmsg = await message.reply('Processing revision, please wait')

    this.llmRevisePromise = this.useLLMRevise(guildHolder, message.content, revision)

    let response
    try {
      response = await this.llmRevisePromise
      await wmsg.delete()
    } catch (error) {
      console.error('Error using LLM:', error)
      await message.reply('Error using LLM, please check the logs')
      this.llmRevisePromise = null
      return
    }

    this.llmRevisePromise = null

    const channel = await guildHolder.guild.channels.fetch(this.forumThreadId)

    const shouldMoveRevision = this.submissionData.currentRevision === message.reference.messageId
    try {
      const [embed, row] = await ReviewEmbed(response, shouldMoveRevision)
      const messageo = await message.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.SuppressNotifications
      })
      const revision = {
        id: messageo.id,
        timestamp: Date.now(),
        data: response
      }
      this.submissionData.revisions.push(messageo.id)
      if (shouldMoveRevision) {
        // edit the original message
        const originalMessage = await channel.messages.fetch(message.reference.messageId)
        const [originalEmbed, originalRow] = await ReviewEmbed((await this.getRevision(this.submissionData.currentRevision)).data, false)
        await originalMessage.edit({
          embeds: [originalEmbed],
          components: [originalRow],
          flags: MessageFlags.SuppressNotifications
        })
        this.submissionData.currentRevision = revision.id
      }
      this.saveRevision(revision)
      this.save()
    } catch (error) {
      console.error('Error creating review embed:', error)
      channel.send('Error creating review embed, please check the logs')
    }

    this.updateStarterMessage(guildHolder)
  }

  static async fromPath (folderPath) {
    const submission = new Submission(Path.basename(folderPath), folderPath)
    await submission.load()
    return submission
  }
}
