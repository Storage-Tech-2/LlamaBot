import { Command } from '../interface/Command.js'
import { Button } from '../interface/Button.js'
import { Menu } from '../interface/Menu.js'
import { Modal } from '../interface/Modal.js'
import { Secrets } from '../Bot.js'
import { Interaction, Message, MessageFlags, PermissionFlagsBits, REST, Routes, Snowflake, TextBasedChannel, TextThreadChannel } from 'discord.js'
import { GuildHolder } from '../GuildHolder.js'
import { Attachment } from '../submissions/Attachment.js'
import { Image } from '../submissions/Image.js'
import Path from 'path'
import fs from 'fs/promises'
import got from 'got'
import sharp from 'sharp'
import { Litematic } from '@kleppe/litematic-reader'
import { Author, AuthorType } from '../submissions/Author.js'
import { ArchiveEntryData } from '../archive/ArchiveEntry.js'
import { GuildConfigs } from '../config/GuildConfigs.js'
import { Submission } from '../submissions/Submission.js'
import { SubmissionConfigs } from '../submissions/SubmissionConfigs.js'
import { Tag } from '../submissions/Tag.js'

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


export async function getAllAttachments(channel: TextThreadChannel): Promise<Attachment[]> {
    let attachments: Attachment[] = [];

    await iterateAllMessages(channel, async (message: Message) => {
        if (message.author.bot) {
            return true;
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
                        // check if duplicate
                        if (attachments.some(attachment => attachment.id === id)) {
                            return;
                        }
                        attachments.push({
                            id: id,
                            name: name,
                            contentType: 'mediafire',
                            url: url,
                            description: `[MediaFire] Sent by ${message.author.username} at ${message.createdAt.toLocaleString()}`,
                            canDownload: false // MediaFire links cannot be downloaded directly
                        })
                    } else if (url.startsWith('https://youtu.be/') || url.startsWith('https://www.youtube.com/watch')) {
                        // YouTube links
                        const videoId = new URL(url).searchParams.get('v') || url.split('/').pop();
                        if (!videoId) return;
                        if (attachments.some(attachment => attachment.id === videoId)) {
                            return;
                        }
                        attachments.push({
                            id: videoId,
                            name: `YouTube Video ${videoId}`,
                            contentType: 'youtube',
                            url: url,
                            description: `[YouTube] Sent by ${message.author.username} at ${message.createdAt.toLocaleString()}`,
                            canDownload: false // YouTube links cannot be downloaded directly
                        })
                    } else if (url.startsWith('https://cdn.discordapp.com/attachments/')) {
                        // https://cdn.discordapp.com/attachments/749137321710059542/912059917106548746/Unbreakable_8gt_reset_6gt_box_replacement.litematic?ex=6832c4bd&is=6831733d&hm=1e5ff51ca94199d70f26ad2611715c86afbb095e3da120416e55352ccf43f7a4&
                        const id = url.split('/')[5]
                        const name = url.split('/')[6].split('?')[0]
                        if (attachments.some(attachment => attachment.id === id)) {
                            return;
                        }
                        attachments.push({
                            id: id,
                            name: name,
                            contentType: 'discord',
                            url: url,
                            description: `[DiscordCDN] Sent by ${message.author.username} at ${message.createdAt.toLocaleString()}`,
                            canDownload: true // Discord CDN links can be downloaded directly
                        })
                    }
                })
            }
        }
        if (message.attachments.size > 0) {
            message.attachments.forEach(attachment => {
                if (attachments.some(attachment2 => attachment2.id === attachment.id)) {
                    // remove duplicate
                    attachments = attachments.filter(a => a.id !== attachment.id);
                    return;
                }
                attachments.push({
                    id: attachment.id,
                    name: attachment.name,
                    contentType: attachment.contentType || 'unknown',
                    url: attachment.url,
                    description: `Sent by ${message.author.username} at ${message.createdAt.toLocaleString()}`,
                    canDownload: true, // Discord attachments can be downloaded directly
                });
            })
        }
        return true;
    });
    return attachments;
}

export function escapeString(str: string): string {
    if (!str) return '';
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
        const s = await sharp(downloadPath)
            .trim()
            .resize({
                width: 800,
                height: 800,
                fit: 'inside',
                withoutEnlargement: true
            })
            .toFormat('png')
            .toFile(processedPath);

        image.width = s.width;
        image.height = s.height;

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
        const key = getFileKey(attachment);
        const attachmentPath = Path.join(attachments_folder, key);
        // If the attachment already exists, skip processing
        if (await fs.access(attachmentPath).then(() => true).catch(() => false)) {
            return;
        }

        const ext = attachment.name.split('.').pop();

        if (attachment.canDownload) {
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

export function getAuthorsString(authors: Author[] | null): string {
    if (!authors || authors.length === 0) {
        return 'No authors';
    }
    return authors.map(author => {
        if (author.type === AuthorType.Discord) {
            return `<@${author.id}>`;
        } else {
            return author.name;
        }
    }).join(', ');
}

export function getCodeAndDescriptionFromTopic(topic: string): { code: string | null, description: string } {
    if (!topic) {
        return { code: null, description: '' };
    }
    // /Code: ([a-zA-Z]*)/
    // description is everything other than the code
    const codeMatch = topic.match(/(Code: ([a-zA-Z0-9_]*))/);
    let code = null;
    let description = topic;
    if (codeMatch) {
        code = codeMatch[2];
        description = topic.replace(codeMatch[1], '').trim();
    }
    return { code, description };
}

export function deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T;
}

export function areObjectsIdentical<T>(obj1: T, obj2: T): boolean {
    // walk
    let stack = [[obj1, obj2]];
    while (stack.length > 0) {
        const [a, b] = stack.pop() as [any, any];

        if (a === b) continue; // same reference or both null

        if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
            return false; // different types or one is null
        }

        if (Array.isArray(a) !== Array.isArray(b)) {
            return false; // one is array, the other is not
        }

        if (Array.isArray(a)) {
            if (a.length !== b.length) {
                return false; // different array lengths
            }
            for (let i = 0; i < a.length; i++) {
                stack.push([a[i], b[i]]); // push each element for comparison
            }
        } else {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);

            if (keysA.length !== keysB.length) {
                return false; // different number of keys
            }

            for (const key of keysA) {
                if (!Object.hasOwn(b, key)) {
                    return false; // key exists in a but not in b
                }
                stack.push([a[key], b[key]]); // push each value for comparison
            }
        }
    }
    return true; // all keys and values match
}

export type Change<T> = {
    old: T;
    new: T;
}

export type Changes = {
    name?: Change<string>;
    code?: Change<string>;
    authors?: Change<Author[]>;
    endorsers?: Change<Author[]>;
    tags?: Change<Tag[]>;
    description?: Change<string>;
    features?: Change<string[]>;
    considerations?: Change<string[]>;
    notes?: Change<string>;
    images?: Change<Image[]>;
    attachments?: Change<Attachment[]>;
}

export function getChange<T>(old: T, updated: T): Change<T> | undefined {
    if (areObjectsIdentical(old, updated)) {
        return undefined;
    }
    return { old, new: updated };
}

export function getChangeIDs<T extends { id: Snowflake }>(old: T[], updated: T[]): Change<T[]> | undefined {
    // Create sets for old and new arrays
    const oldSet = new Set(old.map(item => item.id));
    const newSet = new Set(updated.map(item => item.id));

    // Check if the sets are identical
    if (newSet.size === oldSet.size && oldSet.intersection(newSet).size === oldSet.size) {
        return undefined; // No changes
    }
    return { old, new: updated };
}

export function getChangeNames<T extends { name: string }>(old: T[], updated: T[]): Change<T[]> | undefined {
    // Create sets for old and new arrays
    const oldSet = new Set(old.map(item => item.name));
    const newSet = new Set(updated.map(item => item.name));

    // Check if the sets are identical
    if (newSet.size === oldSet.size && oldSet.intersection(newSet).size === oldSet.size) {
        return undefined; // No changes
    }
    return { old, new: updated };
}


export function getChanges(
    existing: ArchiveEntryData,
    updated: ArchiveEntryData,
): Changes {
    return {
        name: getChange(existing.name, updated.name),
        code: getChange(existing.code, updated.code),
        authors: getChange(existing.authors, updated.authors),
        endorsers: getChange(existing.endorsers, updated.endorsers),
        tags: getChangeNames(existing.tags, updated.tags),
        description: getChange(existing.description, updated.description),
        features: getChange(existing.features, updated.features),
        considerations: getChange(existing.considerations, updated.considerations),
        notes: getChange(existing.notes, updated.notes),
        images: getChangeIDs(existing.images, updated.images),
        attachments: getChangeIDs(existing.attachments, updated.attachments)
    }
}

export function truncateStringWithEllipsis(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
        return str;
    }
    return str.substring(0, maxLength - 3) + '...';
}

export function generateCommitMessage(
    existing: ArchiveEntryData,
    updated: ArchiveEntryData,
): string {
    // --- Diff checks ---------------------------------------------------------
    const changes = getChanges(existing, updated);
    // --- Build message fragments --------------------------------------------
    const fragments: string[] = [];

    if (changes.code) {
        fragments.push(`code changed from “${changes.code.old}” to “${changes.code.new}”`);
    }
    if (changes.name) {
        fragments.push(`renamed “${changes.name.old}” to “${changes.name.new}”`);
    }
    if (changes.authors) fragments.push("updated authors");
    if (changes.endorsers) fragments.push("updated endorsers");
    if (changes.tags) fragments.push("updated tags");
    if (changes.description) fragments.push("updated description");
    if (changes.features) fragments.push("updated features");
    if (changes.considerations) fragments.push("updated considerations");
    if (changes.notes) fragments.push("updated notes");
    if (changes.images) fragments.push("updated images");
    if (changes.attachments) fragments.push("updated attachments");

    // --- Assemble final commit message --------------------------------------
    if (fragments.length === 0) {
        return "No changes";
    }

    // Capitalize first fragment for a cleaner message.
    fragments[0] =
        fragments[0].charAt(0).toUpperCase() + fragments[0].slice(1);

    // Join with commas, inserting “and” before the last item if we have >1.
    let message: string;
    if (fragments.length === 1) {
        message = fragments[0];
    } else {
        const last = fragments.pop();
        message = `${fragments.join(", ")} and ${last}`;
    }

    return message;
}

export function getGithubOwnerAndProject(url: string): { owner: string, project: string } {
    const parsedUrl = new URL(url);
    const pathParts = parsedUrl.pathname.split('/').filter(part => part.length > 0);

    if (pathParts.length < 2) {
        throw new Error('Invalid GitHub URL');
    }

    const owner = pathParts[0];
    const project = pathParts[1].replace(/\.git$/, ''); // Remove .git if present
    return { owner, project };
}

async function iterateAllMessages(channel: TextBasedChannel, iterator: (message: Message) => Promise<boolean>) {
    // Create message pointer
    let message = await channel.messages
        .fetch({ limit: 1 })
        .then(messagePage => (messagePage.size === 1 ? messagePage.at(0) : null));

    while (message) {
        const messages = await channel.messages.fetch({ limit: 100, before: message.id })


        for (const msg of messages.values()) {
            // If the iterator returns false, stop iterating
            if (!await iterator(msg)) {
                return;
            }
        }

        // Update our message pointer to be the last message on the page of messages
        message = 0 < messages.size ? messages.at(messages.size - 1) : null;
    }
}

/**
 * Checks if the interaction has admin permissions.
 */
export function isAdmin(interaction: Interaction): boolean {
    if (!interaction.member || !interaction.inGuild()) {
        return false
    }
    if (interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return true
    }
    return false
}

/**
 * Checks if the interaction has moderator permissions.
 */
export function isModerator(interaction: Interaction): boolean {
    if (!interaction.member || !interaction.inGuild()) {
        return false
    }
    if (interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
        return true
    }
    return false
}

/**
 * Check if the interaction is from the owner of the thread.
 */
export function isOwner(interaction: Interaction): boolean {
    if (!interaction.member || !interaction.inGuild() || !interaction.channel) {
        return false
    }

    if (!interaction.channel.isThread()) {
        return false
    }

    if (interaction.channel.ownerId === interaction.member.user.id) {
        return true
    }

    return false
}

/**
 * Check if the interaction has an endorser role.
 */
export function isEndorser(interaction: Interaction, guildHolder: GuildHolder): boolean {
    if (!interaction.member || !interaction.inCachedGuild()) {
        return false
    }
    const member = interaction.member;
    const endorseRoleIds = guildHolder.getConfigManager().getConfig(GuildConfigs.ENDORSE_ROLE_IDS);
    if (!endorseRoleIds || endorseRoleIds.length === 0) {
        return false;
    }
    for (const roleId of endorseRoleIds) {
        if (member.roles.cache.has(roleId)) {
            return true;
        }
    }
    return false;
}

/**
 * Check if the interaction has an editor role.
 */
export function isEditor(interaction: Interaction, guildHolder: GuildHolder): boolean {
    if (!interaction.member || !interaction.inCachedGuild()) {
        return false
    }
    const member = interaction.member;
    const editorRoleIds = guildHolder.getConfigManager().getConfig(GuildConfigs.EDITOR_ROLE_IDS);
    if (!editorRoleIds || editorRoleIds.length === 0) {
        return false;
    }
    for (const roleId of editorRoleIds) {
        if (member.roles.cache.has(roleId)) {
            return true;
        }
    }
    return false;
}


export function canEditSubmission(interaction: Interaction, submission: Submission): boolean {
    if (!interaction.inCachedGuild() || !interaction.member) {
        return false;
    }

    if (isAdmin(interaction) || isModerator(interaction) || isEditor(interaction, submission.getGuildHolder())) {
        return true;
    }

    if (submission.getConfigManager().getConfig(SubmissionConfigs.IS_LOCKED)) {
        return false;
    }

    if (isOwner(interaction) || isEndorser(interaction, submission.getGuildHolder())) {
        return true;
    }

    return false;
}

export function canPublishSubmission(interaction: Interaction, submission: Submission): boolean {
    if (!interaction.inCachedGuild() || !interaction.member) {
        return false;
    }

    if (isAdmin(interaction) || isModerator(interaction) || isEditor(interaction, submission.getGuildHolder())) {
        return true;
    }

    if (submission.getConfigManager().getConfig(SubmissionConfigs.ON_HOLD)) {
        return false;
    }

    if (isOwner(interaction)) {
        return true;
    }

    return false;
}