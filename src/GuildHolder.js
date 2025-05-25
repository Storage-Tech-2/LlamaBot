const fs = require('fs/promises')
const Path = require('path')
const SubmissionsManager = require('./SubmissionsManager')
const { MessageReferenceType } = require('discord.js')
module.exports = class GuildHolder {
  constructor (guild, bot) {
    this.guild = guild
    this.bot = bot
    this.basePath = Path.join(__dirname, '..', 'config', this.guild.id)

    this.submissionsManager = new SubmissionsManager(Path.join(this.basePath, 'submissions'))
    this.config = {}

    this.setup().then(() => {
      this.loadData().catch(e => {
        console.log('Could not load config for guild ' + this.guild.name)
      })
    })
  }

  async setup () {
    await fs.mkdir(this.basePath, { recursive: true })
    await fs.mkdir(Path.join(this.basePath, 'submissions'), { recursive: true })
  }

  async loadData () {
    const str = await fs.readFile(Path.join(this.basePath, 'config.json'), 'utf8')
    const data = JSON.parse(str)
    if (data.config) {
      for (const prop in data.config) {
        this.config[prop] = data.config[prop]
      }
    }
    console.log(`loaded guild ${this.guild.name}`)
  }

  getConfig (config) {
    return this.config[config]
  }

  setConfig (config, value) {
    this.config[config] = value
    this.markChanged()
  }

  markChanged () {
    this.changed = true
  }

  async saveDataIfNeeded () {
    if (this.changed) {
      this.changed = false
      const data = {
        name: this.guild.name,
        id: this.guild.id,
        timestamp: Date.now(),
        config: this.config
      }

      await fs.writeFile(Path.join(this.basePath, 'config.json'), JSON.stringify(data, null, 2))
    }
  }

  async getSubmission (submissionId) {
    return this.submissionsManager.getSubmission(submissionId)
  }

  async loop () {
    await this.saveDataIfNeeded()
    await this.submissionsManager.purgeOldSubmissions()
  }

  async handleMessage (message) {
    if (message.channel.parentId === this.getConfig('submissions_channel')) {
      const submissionId = message.channel.id
      let submission = await this.submissionsManager.getSubmission(submissionId)
      if (!submission) {
        submission = await this.submissionsManager.makeSubmission(submissionId)
        submission.init(this).catch(e => {
          console.error('Error initializing submission:', e)
        })
      } else {
        submission.check(this)

        // Check if message is a reply to the bot
        if (message.reference && message.reference.type === MessageReferenceType.Default) {
          submission.handleReplies(message, this)
        }
      }
    }
  }
}
