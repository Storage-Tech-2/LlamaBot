import { Command } from '../interface/Command'
import { Button } from '../interface/Button'
import { Menu } from '../interface/Menu'
import { Modal } from '../interface/Modal'
import { Secrets } from '../Bot'
import { MessageFlags, REST, Routes } from 'discord.js'
import { GuildHolder } from '../GuildHolder'
import { Commands } from '../commands'
import { Buttons } from '../components/buttons'
import { Menus } from '../components/menus'
import { Modals } from '../components/modals'

async function getItemsFromArray(itemArray: any[]): Promise<Map<string, any>> {
    const items = new Map()
    for (const item of itemArray) {
        if (items.has(item.getID())) {
            throw new Error('Duplicate item ' + item.getID())
        }
        items.set(item.getID(), item)
    }
    return items
}

export async function getCommands(): Promise<Map<string, Command>> {
    return getItemsFromArray(Commands)
}

export async function getButtons(): Promise<Map<string, Button>> {
    return getItemsFromArray(Buttons)
}

export async function getMenus(): Promise<Map<string, Menu>> {
    return getItemsFromArray(Menus)
}

export async function getModals(): Promise<Map<string, Modal>> {
    return getItemsFromArray(Modals)
}


export async function deployCommands(
    commandsMap: Map<string, Command>,
    guildHolder: GuildHolder,
    secrets: Secrets
) {
    const commands = Array.from(commandsMap, command => command[1].getBuilder(guildHolder).toJSON())

    const rest = new REST().setToken(secrets.token)

    return rest.put(Routes.applicationGuildCommands(secrets.clientId, guildHolder.getGuildId()), { body: commands })
}


export function replyEphemeral(interaction: any, content: string, options = {}) {
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