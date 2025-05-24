const fs = require('fs/promises')
const path = require('path')
const commandsPath = path.join(__dirname, '../commands')
class CommandUtils {
  static async getCommands () {
    const commands = new Map()
    const commandFiles = (await fs.readdir(commandsPath)).filter(file => file.endsWith('.js'))

    for (const file of commandFiles) {
      const command = require(path.join(commandsPath, file))
      commands.set(command.getData().name, command)
    }
    return commands
  }

  static async deployCommands (commandsMap, token, clientId, guildId) {
    const { REST, Routes } = require('discord.js')
    const commands = Array.from(commandsMap, command => command[1].getData().toJSON())

    const rest = new REST().setToken(token)

    return rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands })
  }
}

module.exports = CommandUtils
