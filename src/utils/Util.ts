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
import { SubmissionStatus } from '../submissions/SubmissionStatus.js'

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


export async function replyEphemeral(interaction: any, content: string, options = {}) {
    try {
        if (!interaction.replied) {
            return await interaction.reply({
                ...options,
                content: content,
                flags: MessageFlags.Ephemeral
            })
        } else {
            return await interaction.followUp({
                ...options,
                content: content,
                flags: MessageFlags.Ephemeral
            })
        }
    } catch (error: any) {
        console.error('Error replying ephemeral:', error);
        return null;
    }
}


export function getAttachmentsFromMessage(message: Message, attachments: Attachment[] = []): Attachment[] {
    if (message.content.length > 0) {
        // Find all URLs in the message
        const urls = message.content.match(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g)
        if (urls) {
            urls.forEach(url => {
                // Check if mediafire
                // https://www.mediafire.com/file/idjbw9lc1kt4obj/1_17_Crafter-r2.zip/file
                // https://www.mediafire.com/folder/5ajiire4a6cs5/Scorpio+MIS
                if (url.startsWith('https://www.mediafire.com/file/') || url.startsWith('https://www.mediafire.com/folder/')) {
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
            const index = attachments.findIndex(attachment2 => attachment2.id === attachment.id);

            if (index !== -1) {
                // remove duplicate
                attachments.splice(index, 1);
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
    return attachments;
}

export async function getAllAttachments(channel: TextThreadChannel): Promise<Attachment[]> {
    let attachments: Attachment[] = [];

    await iterateAllMessages(channel, async (message: Message) => {
        if (message.author.bot) {
            return true;
        }
        // Get attachments from the message
        getAttachmentsFromMessage(message, attachments);

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

export async function processImages(images: Image[], download_folder: string, processed_folder: string, forDiscord: boolean): Promise<Image[]> {
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
        let imageData;
        try {
            imageData = await got(image.url, { responseType: 'buffer' });
        } catch (error) {
            throw new Error(`Failed to download image ${image.name} at ${image.url}, try reuploading the file directly to the thread.`);
        }
        await fs.writeFile(downloadPath, imageData.body);
        let s;
        if (forDiscord) {

            s = await sharp(downloadPath)
                .trim()
                .resize({
                    width: 386 * 2,
                    height: 258 * 2 - 40,
                    fit: 'contain',
                    // withoutEnlargement: true,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .extend({
                    bottom: 40,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .toFormat('png')
                .toFile(processedPath);
        } else {
            s = await sharp(downloadPath)
                .trim()
                .resize({
                    width: 800,
                    height: 800,
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .toFormat('png')
                .toFile(processedPath);
        }

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

export async function processAttachments(attachments: Attachment[], attachments_folder: string, remove_old: boolean = true): Promise<Attachment[]> {
    // Check if the folder exists, if not, create it
    if (attachments.length > 0) {
        if (!await fs.access(attachments_folder).then(() => true).catch(() => false)) {
            await fs.mkdir(attachments_folder, { recursive: true });
        }
    }

    // Remove attachments that are already processed but not in the current list
    if (remove_old) {
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
    }

    // Process each attachment
    await Promise.all(attachments.map(async attachment => {
        const key = getFileKey(attachment);
        const attachmentPath = Path.join(attachments_folder, key);

        const ext = attachment.name.split('.').pop();

        if (attachment.canDownload) {

            // If the attachment already exists, skip download
            if (!await fs.access(attachmentPath).then(() => true).catch(() => false)) {
                try {
                    const attachmentData = await got(attachment.url, { responseType: 'buffer' });
                    await fs.writeFile(attachmentPath, attachmentData.body);
                } catch (error) {
                    throw new Error(`Failed to download attachment ${attachment.name} at ${attachment.url}, try reuploading the file directly to the thread.`);
                }
            }

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
        const name = author.displayName || author.username || 'Unknown';
        if (author.type === AuthorType.DiscordInGuild) {
            return `<@${author.id}>`;
        } else if (author.type === AuthorType.DiscordExternal) {
            return `${escapeDiscordString(name)} (<@${author.id}>)`;
        } else {
            return escapeDiscordString(name);
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
    const messages = await channel.messages.fetch({ limit: 100 })
    for (const msg of messages.values()) {
        // If the iterator returns false, stop iterating
        if (!await iterator(msg)) {
            return;
        }
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
export function isAuthor(interaction: Interaction, submission: Submission): boolean {
    if (!interaction.member || !interaction.inGuild() || !interaction.channel) {
        return false
    }

    if (!interaction.channel.isThread()) {
        return false
    }

    if (interaction.channel.ownerId === interaction.member.user.id) {
        return true
    }

    // Check if the interaction is from the author of the submission
    const authors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS);
    if (authors && authors.length > 0) {
        for (const author of authors) {
            if (author.type === AuthorType.Unknown) continue; // Skip unknown authors
            if (author.id === interaction.member.user.id) {
                return true;
            }
        }
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

    if (isAdmin(interaction) || isModerator(interaction) || isEditor(interaction, submission.getGuildHolder()) || isEndorser(interaction, submission.getGuildHolder())) {
        return true;
    }

    if (submission.getConfigManager().getConfig(SubmissionConfigs.IS_LOCKED)) {
        return false;
    }

    if (isAuthor(interaction, submission)) {
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

    if (submission.getConfigManager().getConfig(SubmissionConfigs.ON_HOLD) || (submission.getConfigManager().getConfig(SubmissionConfigs.STATUS) !== SubmissionStatus.WAITING && submission.getConfigManager().getConfig(SubmissionConfigs.IS_LOCKED))) {
        return false;
    }

    if (isAuthor(interaction, submission)) {
        return true;
    }

    return false;
}

export function canSetPrivilegedTags(interaction: Interaction, submission: Submission): boolean {
    if (!interaction.inCachedGuild() || !interaction.member) {
        return false;
    }

    if (isAdmin(interaction) || isModerator(interaction) || isEditor(interaction, submission.getGuildHolder())) {
        return true;
    }

    return false
}

export async function reclassifyAuthors(guildHolder: GuildHolder, list: Author[]): Promise<Author[]> {
    return Promise.all(list.map(async author => {
        const newAuthor: Author = { ...author };
        if (author.type === AuthorType.Unknown || !author.id || author.type === AuthorType.DiscordDeleted) {
            // keep as is
            return newAuthor;
        }

        const member = await guildHolder.getGuild().members.fetch(author.id).catch(() => null);
        if (member) { // is a member of the guild
            newAuthor.type = AuthorType.DiscordInGuild;
            newAuthor.displayName = member.displayName;
            newAuthor.username = member.user.username;
            newAuthor.iconURL = member.user.displayAvatarURL();
        } else {
            const user = await guildHolder.getBot().client.users.fetch(author.id).catch(() => null);
            if (user) { // is a user but not a member of the guild
                newAuthor.type = AuthorType.DiscordExternal;
                newAuthor.username = user.username;
                newAuthor.iconURL = user.displayAvatarURL();
            } else {
                newAuthor.type = AuthorType.DiscordDeleted;
            }
        }
        return newAuthor;
    }));
}

export function splitCode(code: string): { channelCode: string, entryNumber: number } {
    // code is in the format "[a-zA-Z]*[0-9]+"
    const match = code.match(/^([a-zA-Z]+)(\d+)$/);
    if (!match) {
        return { channelCode: '', entryNumber: -1 }
    }
    const channelCode = match[1];
    const entryNumber = parseInt(match[2]);
    if (isNaN(entryNumber)) {
        return { channelCode: '', entryNumber: -1 }
    }

    return { channelCode, entryNumber };
}

export function splitIntoChunks(text: string, max: number): string[] {
    if (max < 2) {
        throw new Error("`max` must be ≥ 2 so a hyphen can be added on hard splits.");
    }

    const chunks = [];
    let i = 0;

    while (i < text.length) {
        // Take at most `max` characters as a window to inspect
        const windowEnd = Math.min(i + max, text.length);
        const window = text.slice(i, windowEnd);

        if (windowEnd === text.length) {
            // If we reached the end of the text, take the rest
            chunks.push(window);
            break; // Exit the loop
        }

        // 1️⃣ Look for the right-most newline inside the window
        let breakPos = window.lastIndexOf("\n");

        // 2️⃣ If none, look for the right-most space
        if (breakPos === -1) breakPos = window.lastIndexOf(" ");

        // 3️⃣ If still none *and* we are not at the very end, force-split the word
        if (breakPos === -1 && windowEnd < text.length) {
            const hardSplitPos = max - 1;            // leave room for a hyphen
            chunks.push(window.slice(0, hardSplitPos) + "-");
            i += hardSplitPos;                        // advance by the piece we kept
            continue;                                // loop again, same index now points to remainder
        }

        // If there was no delimiter but we reached the true end, take the rest
        if (breakPos === -1) breakPos = window.length;

        chunks.push(window.slice(0, breakPos));
        i += breakPos;

        // Skip over the delimiter we split on (newline or space)
        if (text[i] === "\n" || text[i] === " ") i += 1;
    }

    return chunks;
}

export function extractUserIdsFromText(text: string): Snowflake[] {
    const userIds: Snowflake[] = [];
    const regex = /<@!?(\d{17,19})>/g; // Matches <@123456789012345678> or <@!123456789012345678>
    let match;
    while ((match = regex.exec(text)) !== null) {
        const userId = match[1]; // The first capturing group contains the user ID
        if (userId && !userIds.includes(userId)) {
            userIds.push(userId as Snowflake);
        }
    }
    return userIds;
}

export function escapeDiscordString(str: string): string {
    if (!str) return '';
    return str
        .replace(/\\/g, '\\\\') // Escape backslashes
        .replace(/`/g, '\\`')   // Escape backticks
        .replace(/_/g, '\\_')   // Escape underscores
        .replace(/\*/g, '\\*')   // Escape asterisks
        .replace(/~/g, '\\~')   // Escape tildes
        .replace(/>/g, '\\>')   // Escape greater than
        .replace(/</g, '\\<')   // Escape less than
        .replace(/!/g, '\\!');  // Escape exclamation marks
}

export function truncateFileName(fileName: string, maxLength: number): string {
    if (fileName.length <= maxLength) {
        return fileName;
    }
    const extension = Path.extname(fileName);
    const baseName = Path.basename(fileName, extension);
    const truncatedBaseName = baseName.slice(0, Math.max(0, maxLength - extension.length - 3)); // Leave space for "..."
    let newName = `${truncatedBaseName}...${extension}`;
    if (newName.length > maxLength) {
        // If the truncated name is still too long, truncate further
        newName = newName.slice(0, maxLength);
    }
    return newName;
}

export async function getAuthorFromIdentifier(guildHolder: GuildHolder, identifier: string): Promise<Author | null> {
    // check if identifier is a valid Discord ID
    const isId = /^\d{17,19}$/.test(identifier) || (identifier.startsWith('<@') && identifier.endsWith('>'));
    const author: Author = {
        type: AuthorType.Unknown,
        username: identifier,
    }
    if (isId) {
        const userId = identifier.replace(/<@!?/, '').replace(/>/, '');
        const user = await guildHolder.getBot().client.users.fetch(userId).catch(() => null);
        if (!user) {
            return null; // User not found
        }

        author.id = user.id;
        author.username = user.username;
        author.displayName = user.username;
        author.iconURL = user.displayAvatarURL();
        author.type = AuthorType.DiscordInGuild;
    }
    return author;
}

export function areAuthorsSame(
    author1: Author | null,
    author2: Author | null,
): boolean {
    if (!author1 && !author2) return true; // Both are null
    if (!author1 || !author2) return false; // One is null, the other is not

    // Compare IDs and types
    if (author1.id === author2.id) {
        return true;
    }

    // if they are not unknown, then retun false
    if (author1.type !== AuthorType.Unknown && author2.type !== AuthorType.Unknown) {
        return false;
    }

    // compare usernames
    return author1.username === author2.username;
}