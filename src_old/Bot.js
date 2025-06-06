const GuildHolder = require('./GuildHolder.js')
const { Client, GatewayIntentBits } = require('discord.js')
const CommandUtils = require('./util/CommandUtils.js')
const LLMUtils = require('./util/LLMUtils.js')
const fs = require('fs/promises')
const path = require('path')
const Utils = require('./util/Utils.js')
const GUIUtils = require('./util/GuiUtils.js')
module.exports = class Bot {
  constructor () {
    this.guilds = new Map()
    this.llmQueue = []
    this.llmProcessing = false
  }

  async start (secrets) {
    if (this.client) {
      console.error('Bot is already running')
      return
    }

    await fs.mkdir(path.join(__dirname, '..', 'config')).catch((e) => {

    })

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
      ]
    })

    this.commands = await CommandUtils.getCommands()
    this.buttons = await GUIUtils.getButtons()
    this.menus = await GUIUtils.getMenus()
    this.modals = await GUIUtils.getModals()

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

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.inGuild()) {
        return Utils.replyEphemeral(interaction, 'Cannot use outside of guild!')
      }

      if (interaction.isCommand()) {
        const command = this.commands.get(interaction.commandName)
        if (!command) return

        try {
          await command.execute(interaction, this)
        } catch (error) {
          console.error(error)
          return Utils.replyEphemeral(interaction, 'An error occurred while executing the command.')
        }
      } else if (interaction.isButton()) {
        const customId = interaction.customId.split('|')
        const button = this.buttons.get(customId[0])
        if (!button) return

        try {
          await button.execute(interaction, this, ...customId.slice(1))
        } catch (error) {
          console.error(error)
          return Utils.replyEphemeral(interaction, 'An error occurred while executing the button.')
        }
      } else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
        const customId = interaction.customId.split('|')
        const menu = this.menus.get(customId[0])
        if (!menu) return

        try {
          await menu.execute(interaction, this, ...customId.slice(1))
        } catch (error) {
          console.error(error)
          return Utils.replyEphemeral(interaction, 'An error occurred while executing the menu.')
        }
      } else if (interaction.isModalSubmit()) {
        const customId = interaction.customId.split('|')
        const modal = this.modals.get(customId[0])
        if (!modal) return

        try {
          await modal.execute(interaction, this, ...customId.slice(1))
        } catch (error) {
          console.error(error)
          return Utils.replyEphemeral(interaction, 'An error occurred while executing the modal.')
        }
      } else {
        return Utils.replyEphemeral(interaction, 'Unknown interaction type!')
      }
    })

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return
      if (!message.inGuild()) return

      const guildHolder = this.guilds.get(message.guildId)
      if (!guildHolder) return

      // Handle message in guild
      await guildHolder.handleMessage(message)
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

    this.processLLMQueue()

    setTimeout(() => this.loop(), 1000)
  }

  async addLLMRequest (prompt) {
    return new Promise((resolve, reject) => {
      this.llmQueue.push({ prompt, resolve, reject })
      this.processLLMQueue()
    })
  }

  async processLLMQueue () {
    if (this.llmProcessing || this.llmQueue.length === 0) {
      return
    }

    this.llmProcessing = true

    const { prompt, resolve, reject } = this.llmQueue.shift()

    if (prompt.length === 0) {
      this.llmProcessing = false
      reject(new Error('Prompt is empty'))
      return
    }

    // Check if the prompt is too long
    if (prompt.length > 4000) {
      this.llmProcessing = false
      reject(new Error(`Prompt is too long (${prompt.length} characters)`))
      return
    }

    try {
      const response = await LLMUtils.getLLMResponse(prompt)
      resolve(response)
    } catch (error) {
      reject(error)
    }

    this.llmProcessing = false
    if (this.llmQueue.length > 0) {
      this.processLLMQueue()
    }
  }
}
