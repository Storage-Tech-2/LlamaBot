const GuildHolder = require('./GuildHolder.js')
const { Client, Intents } = require('discord.js')
const CommandUtils = require('./util/CommandUtils.js')

module.exports = class Bot {
  constructor () {
    this.guilds = new Map()
  }

  async start (secrets) {
    if (this.client) {
      console.error('Bot is already running')
      return
    }

    this.client = new Client({
      intents: [Intents.FLAGS.GUILDS]
    })

    this.commands = await CommandUtils.getCommands()

    this.setupListeners(secrets)
    this.client.login(secrets.token)

    return new Promise((resolve, reject) => {
      this.client.once('ready', async () => {
        this.ready = true

        const guilds = await Promise.all((await this.client.guilds.fetch()).map((guild) => guild.fetch()))
        guilds.forEach((guild) => {
          this.guilds.set(guild.id, new GuildHolder(guild, this))
          CommandUtils.deployCommands(this.commands, secrets.token, secrets.clientId, guild.id)
        })

        this.loop()

        console.log('Bot is ready')
        resolve(this)
      })

      this.client.once('error', (err) => {
        console.error('Error starting bot:', err)
        reject(err)
      })
    })
  }

  setupListeners (secrets) {
    this.client.on('guildCreate', (guild) => {
      console.log(`Joined guild: ${guild.name} (${guild.id})`)
      this.guilds.set(guild.id, new GuildHolder(guild, this))
      CommandUtils.deployCommands(this.commands, secrets.token, secrets.clientId, guild.id)
    })

    this.client.on('guildDelete', (guild) => {
      console.log(`Left guild: ${guild.name} (${guild.id})`)
      this.guilds.delete(guild.id)
    })
  }

  async loop () {
    if (!this.ready) {
      console.error('Bot is not ready')
      return
    }

    for (const guildHolder of this.guilds.values()) {
      await guildHolder.loop()
    }

    setTimeout(() => this.loop(), 1000)
  }
}
