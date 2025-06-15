import { Command } from '../interface/Command'
import { Button } from '../interface/Button'
import { Menu } from '../interface/Menu'
import { Modal } from '../interface/Modal'
import { Secrets } from '../Bot'
import { GuildMember, Interaction, MessageFlags, PermissionFlagsBits, REST, Routes, TextChannel, TextThreadChannel } from 'discord.js'
import { GuildHolder } from '../GuildHolder'
import { Attachment } from '../submissions/Attachment'
import { Image } from '../submissions/Image'
import Path from 'path'
import fs from 'fs/promises'
import got from 'got'
import sharp from 'sharp'
import { Litematic } from '@kleppe/litematic-reader'

export function getItemsFromArray<T extends (Button | Menu | Modal | Command)>(itemArray: T[]): Map<string, T> {
    const items = new Map()
    for (const item of itemArray) {
        if (items.has(item.getID())) {
            throw new Error('Duplicate item ' + item.getID())
        }
        items.set(item.getID(), item)
    }
    return items
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

export function hasPerms(interaction: Interaction): boolean {
    if (!interaction.member) {
        return false
    }
    const member = interaction.member as GuildMember;
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return true
    }
    return false
}

export function isOwner(interaction: Interaction): boolean {
    if (!interaction.member || !interaction.channel) {
        return false
    }

    if (!interaction.channel.isThread()) {
        return false
    }

    const member = interaction.member as GuildMember;
    if (interaction.channel.ownerId === member.id) {
        return true
    }

    return false
}


export async function getAllAttachments(channel: TextThreadChannel): Promise<Attachment[]> {
    return channel.messages.fetch({ limit: 100 }).then(messages => {
        const attachments: Attachment[] = [];
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
                                description: `[MediaFire] Sent by ${message.author.username} at ${message.createdAt.toLocaleString()}`
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
                                description: `[DiscordCDN] Sent by ${message.author.username} at ${message.createdAt.toLocaleString()}`
                            })
                        }
                    })
                }
            }
            if (message.attachments.size > 0) {
                message.attachments.forEach(attachment => {
                    attachments.push({
                        id: attachment.id,
                        name: attachment.name,
                        contentType: attachment.contentType || 'unknown',
                        url: attachment.url,
                        description: `Sent by ${message.author.username} at ${message.createdAt.toLocaleString()}`
                    });
                })
            }
        })
        return attachments
    })
}

export function escapeString(str: string): string {
    return str
        .trim()
        .replace(/ +/g, '_')
        .replace(/[^a-zA-Z0-9_\-.]/g, '')
}

export function getFileKey(file: Attachment | Image, new_ext: string = '') {
    const name = `${file.id}-${escapeString(file.name)}`.toLowerCase();
    // First, get file extension if it exists
    const split = name.split('.')
    let ext = split.length > 1 ? split.pop() : '';
    if (new_ext) {
        ext = new_ext.toLowerCase();
    }
    const prefix = split.join('.');
    // Then, escape the string
    const escapedPrefix = escapeString(prefix)
    const escapedExt = ext ? `.${escapeString(ext)}` : ''
    return `${escapedPrefix}${escapedExt}`;
}

export async function processImages(images: Image[], download_folder: string, processed_folder: string): Promise<Image[]> {
    if (images.length > 0) {
        // Check if the folders exist, if not, create them
        if (!await fs.access(download_folder).then(() => true).catch(() => false)) {
            await fs.mkdir(download_folder, { recursive: true });
        }
        if (!await fs.access(processed_folder).then(() => true).catch(() => false)) {
            await fs.mkdir(processed_folder, { recursive: true });
        }
    }

    // Remove images that are already processed but not in the current list
    const existingFiles = await fs.readdir(processed_folder);
    await Promise.all(existingFiles.map(async file => {
        // check if the file is in the images list
        const fileKey = file.toLowerCase();
        if (!images.some(image => getFileKey(image, 'png') === fileKey)) {
            const filePath = Path.join(processed_folder, file);
            try {
                await fs.unlink(filePath);
            } catch (err) {
                console.error(`Failed to remove file ${filePath}:`, err);
            }
        }
    }));

    await Promise.all(images.map(async image => {
        const processedPath = Path.join(processed_folder, getFileKey(image, 'png'));
        // If the processed image already exists, skip processing
        if (await fs.access(processedPath).then(() => true).catch(() => false)) {
            return;
        }

        const downloadPath = Path.join(download_folder, getFileKey(image));
        const imageData = await got(image.url, { responseType: 'buffer' })
        await fs.writeFile(downloadPath, imageData.body);
        await sharp(downloadPath)
            .trim()
            .resize({
                width: 800,
                height: 800,
                fit: 'inside',
                withoutEnlargement: true
            })
            .toFormat('png')
            .toFile(processedPath)
        await fs.unlink(downloadPath); // Remove the original file after processing
    }));

    // Remove the download folder if it was created
    try {
        await fs.rmdir(download_folder);
    } catch (err) {

    }

    return images;

}

export async function processAttachments(attachments: Attachment[], attachments_folder: string): Promise<Attachment[]> {
    // Check if the folder exists, if not, create it
    if (attachments.length > 0) {
        if (!await fs.access(attachments_folder).then(() => true).catch(() => false)) {
            await fs.mkdir(attachments_folder, { recursive: true });
        }
    }

    // Remove attachments that are already processed but not in the current list
    const existingFiles = await fs.readdir(attachments_folder);
    await Promise.all(existingFiles.map(async file => {
        // check if the file is in the attachments list
        const fileKey = file.toLowerCase();
        if (!attachments.some(attachment => getFileKey(attachment) === fileKey)) {
            const filePath = Path.join(attachments_folder, file);
            try {
                await fs.unlink(filePath);
            } catch (err) {
                console.error(`Failed to remove file ${filePath}:`, err);
            }
        }
    }));

    // Process each attachment
    await Promise.all(attachments.map(async attachment => {
        const attachmentPath = Path.join(attachments_folder, getFileKey(attachment));
        // If the attachment already exists, skip processing
        if (await fs.access(attachmentPath).then(() => true).catch(() => false)) {
            return;
        }

        const ext = attachment.name.split('.').pop();

        if (attachment.contentType !== 'mediafire') {
            const attachmentData = await got(attachment.url, { responseType: 'buffer' });
            await fs.writeFile(attachmentPath, attachmentData.body);
            if (ext === 'litematic') {
                try {
                    const litematicFile = await fs.readFile(attachmentPath);
                    const litematic = new Litematic(litematicFile as any)
                    await litematic.read()

                    const dataVersion = litematic.litematic?.nbtData.MinecraftDataVersion ?? 0;
                    const version = dataVersionToMinecraftVersion(dataVersion);
                    const size = litematic.litematic?.blocks ?? { minx: 0, miny: 0, minz: 0, maxx: 0, maxy: 0, maxz: 0 };
                    const sizeString = `${size.maxx - size.minx + 1}x${size.maxy - size.miny + 1}x${size.maxz - size.minz + 1}`
                    attachment.litematic = {
                        size: sizeString,
                        version: version
                    }
                } catch (error) {
                    console.error('Error processing litematic file:', error)
                    attachment.litematic = {
                        error: 'Error processing litematic file'
                    }
                }
            }
        }
    }));

    return attachments;
}


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

export function dataVersionToMinecraftVersion(dataVersion: number): string {
    if (dataVersion in DATA_VERSION_TO_RELEASE) {
        return DATA_VERSION_TO_RELEASE[dataVersion as keyof typeof DATA_VERSION_TO_RELEASE];
    } else {
        // find closest below and above
        let closestBelow = null
        let closestAbove = null
        for (const versionRaw of Object.keys(DATA_VERSION_TO_RELEASE)) {
            const version = parseInt(versionRaw)
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
            return `${DATA_VERSION_TO_RELEASE[closestBelow as keyof typeof DATA_VERSION_TO_RELEASE]} - ${DATA_VERSION_TO_RELEASE[closestAbove as keyof typeof DATA_VERSION_TO_RELEASE]}`
        } else if (closestBelow) {
            return DATA_VERSION_TO_RELEASE[closestBelow as keyof typeof DATA_VERSION_TO_RELEASE]
        } else if (closestAbove) {
            return DATA_VERSION_TO_RELEASE[closestAbove as keyof typeof DATA_VERSION_TO_RELEASE]
        } else {
            return 'Unknown'
        }
    }
}