import { Command } from '../interface/Command.js'
import { Button } from '../interface/Button.js'
import { Menu } from '../interface/Menu.js'
import { Modal } from '../interface/Modal.js'
import { Bot, Secrets } from '../Bot.js'
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
import { MCMeta } from './MCMeta.js'

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

export async function processImages(images: Image[], download_folder: string, processed_folder: string, bot: Bot): Promise<Image[]> {
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

    const imageURLs = images.map(image => image.url);
    const refreshedURLs = await refreshAttachments(imageURLs, bot);

    await Promise.all(images.map(async (image, i) => {
        const processedPath = Path.join(processed_folder, getFileKey(image, 'png'));
        // If the processed image already exists, skip processing
        if (await fs.access(processedPath).then(() => true).catch(() => false)) {
            return;
        }

        const downloadPath = Path.join(download_folder, getFileKey(image));
        let imageData;
        try {
            imageData = await got(refreshedURLs[i], { responseType: 'buffer' });
        } catch (error) {
            throw new Error(`Failed to download image ${image.name} at ${refreshedURLs[i]}, try reuploading the file directly to the thread.`);
        }
        await fs.writeFile(downloadPath, imageData.body);
        let simage = sharp(downloadPath);
        const stats = await simage.stats();
        if (!stats.isOpaque) {
            simage = simage.trim();
        }

        const s = await simage
            .resize({
                width: 800,
                height: 800,
                fit: 'inside',
                withoutEnlargement: true,
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


export async function processImageForDiscord(file_path: string, num_images: number, image_idx: number, isGalleryView: boolean): Promise<string> {
    const output_path = file_path + '.discord.png';
    let newWidth = 386 * 2;
    let newHeight = 258 * 2;
    let padding = 0;

    if (isGalleryView) {
        if (num_images === 1) { // Single image, use larger size
            padding = 60;
            newHeight = newHeight - padding;
        } else if (num_images === 2) { // Two images, width is half
            newWidth = Math.floor(newWidth / 2) - 15;
            padding = 60;
            newHeight = newHeight - padding;
        } else if (num_images === 3) { // Three images
            if (image_idx === 0) { // First image is large
                newWidth = 2 * Math.floor(newWidth / 3) - 15;
                newHeight = newHeight;
            } else { // Other two images are small
                newWidth = Math.floor(newWidth / 3) - 15;
                newHeight = Math.floor(newHeight / 2) - 15;
            }
            padding = 0;
        } else if (num_images === 4) { // Four images, all are small
            padding = 0;
        } else { // More than four images, all are tiny
            padding = 0;
        }
    } else { // not gallery view, use 1:1 aspect ratio
        newWidth = 800;
        newHeight = 800;
    }

    // Scale so that largest dimension is 800px
    if (newWidth > newHeight) {
        const scale = 800 / newWidth;
        newWidth = 800;
        newHeight = Math.floor(newHeight * scale);
        // also scale padding
        padding = Math.floor(padding * scale);
    } else {
        const scale = 800 / newHeight;
        newHeight = 800;
        newWidth = Math.floor(newWidth * scale);
        // also scale padding
        padding = Math.floor(padding * scale);
    }

    await sharp(file_path)
        .resize({
            width: newWidth,
            height: newHeight,
            fit: 'contain',
            // withoutEnlargement: true,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .extend({
            bottom: padding,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .toFormat('png')
        .toFile(output_path);

    return output_path;
}

export async function processAttachments(attachments: Attachment[], attachments_folder: string, bot: Bot, remove_old: boolean = true): Promise<Attachment[]> {
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



    const attachmentURLs = attachments.map(a => a.url);
    const attachmentURLsRefreshed = await refreshAttachments(attachmentURLs, bot);

    const mcMeta = new MCMeta();
    await mcMeta.fetchVersionData();

    // Process each attachment
    await Promise.all(attachments.map(async (attachment, index) => {
        const key = getFileKey(attachment);
        const attachmentPath = Path.join(attachments_folder, key);

        const ext = attachment.name.split('.').pop();

        if (attachment.canDownload) {

            // If the attachment already exists, skip download
            if (!await fs.access(attachmentPath).then(() => true).catch(() => false)) {
                try {
                    const attachmentData = await got(attachmentURLsRefreshed[index], { responseType: 'buffer' });
                    await fs.writeFile(attachmentPath, attachmentData.body);
                } catch (error) {
                    throw new Error(`Failed to download attachment ${attachment.name} at ${attachmentURLsRefreshed[index]}, try reuploading the file directly to the thread.`);
                }
            }

            if (ext === 'litematic') {
                try {
                    const litematicFile = await fs.readFile(attachmentPath);
                    const litematic = new Litematic(litematicFile as any)
                    await litematic.read()

                    const dataVersion = litematic.litematic?.nbtData.MinecraftDataVersion ?? 0;
                    const version = mcMeta.getByDataVersion(dataVersion);
                    const size = litematic.litematic?.blocks ?? { minx: 0, miny: 0, minz: 0, maxx: 0, maxy: 0, maxz: 0 };
                    const sizeString = `${size.maxx - size.minx + 1}x${size.maxy - size.miny + 1}x${size.maxz - size.minz + 1}`
                    attachment.litematic = {
                        size: sizeString,
                        version: version ? version.id : 'Unknown',
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
    let messages = await channel.messages.fetch({ limit: 100 });
    while (messages.size > 0) {
        for (const msg of messages.values()) {
            // If the iterator returns false, stop iterating
            if (!await iterator(msg)) {
                return;
            }
        }
        messages = await channel.messages.fetch({ limit: 100, before: messages.last()?.id });
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
            if (author.dontDisplay) continue; // Skip authors that don't want to be displayed
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
        const user = await guildHolder.getGuild().members.fetch(userId).catch(() => null);
        if (user) {

            author.id = user.id;
            author.username = user.user.username;
            author.displayName = user.displayName;
            author.iconURL = user.displayAvatarURL();
            author.type = AuthorType.DiscordInGuild;
        } else {
            // try to fetch the user from the client
            const user = await guildHolder.getBot().client.users.fetch(userId).catch(() => null);
            if (user) {
                author.id = user.id;
                author.username = user.username;
                author.iconURL = user.displayAvatarURL();
                author.type = AuthorType.DiscordExternal;
            } else {
                return null; // User not found
            }
        }
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
    if (author1.id && author2.id && author1.id === author2.id) {
        return true;
    }

    // if they are not unknown, then retun false
    if (author1.type !== AuthorType.Unknown && author2.type !== AuthorType.Unknown) {
        return false;
    }

    // compare usernames
    return author1.username === author2.username;
}

export async function refreshAttachments(
    attachmentURLs: string[],
    bot: Bot
): Promise<string[]> {
    if (!attachmentURLs || attachmentURLs.length === 0) {
        return [];
    }

    const attachmentObjects: { url: string }[] = attachmentURLs.map(url => ({ url }));
    const expiringAttachments = attachmentObjects.filter(obj => {
        const url = obj.url;
        if (!url) return false; // No URL provided

        // Check if discord cdn
        if (!url.startsWith('https://cdn.discordapp.com/attachments/')) {
            return false; // Not a Discord CDN URL
        }
        // get the `ex` parameter from the URL
        const urlObj = new URL(url);
        const exParam = urlObj.searchParams.get('ex');
        if (!exParam) return false; // No expiration parameter
        if (parseInt(exParam, 16) * 1000 > Date.now()) { // If the expiration is in the future, keep it
            return !(urlObj.searchParams.get("is") && urlObj.searchParams.get("hm"))
        }
        // check other parameters
        return true;
    });

    if (expiringAttachments.length > 0) {
        try {
            const result = await bot.client.rest.post('/attachments/refresh-urls', {
                body: {
                    attachment_urls: expiringAttachments.map(a => a.url)
                },
            }) as any;
            if (!result || !result.refreshed_urls || !Array.isArray(result.refreshed_urls)) {
                throw new Error('Invalid response from attachment refresh API');
            }

            result.refreshed_urls.forEach((data: { original: string, refreshed: string }) => {
                if (!data.original || !data.refreshed) {
                    console.warn(`Invalid data received for attachment refresh: ${JSON.stringify(data)}`);
                    return;
                }
                const index = attachmentObjects.findIndex(obj => obj.url === data.original);
                if (index !== -1) {
                    attachmentObjects[index].url = data.refreshed;
                } else {
                    console.warn(`Original URL ${data.original} not found in attachment objects.`);
                }
            });
        } catch (error: any) {
            console.error(`Failed to refresh attachment URLs: ${error.message}`);
            throw new Error(`Failed to refresh attachment URLs, try reuploading the files directly to the thread. Error: ${error.message}`);
        }
    }
    return attachmentObjects.map(obj => obj.url);
}

export function areAuthorsListEqual(
    list1: Author[] | null,
    list2: Author[] | null,
    checkSharedFields: boolean = false,
    checkUniqueFields: boolean = false,
): boolean {
    if (!list1 && !list2) return true; // Both are null
    if (!list1 || !list2) return false; // One is null, the other is not

    if (list1.length !== list2.length) return false; // Different lengths


    for (let i = 0; i < list1.length; i++) {
        const author1 = list1[i];
        const otherFound = list2.find(author2 => {
            return areAuthorsSame(author1, author2);
        });
        if (!otherFound) {
            return false; // No matching author found
        }
        if (checkSharedFields) {
            if (author1.type !== otherFound.type || author1.id !== otherFound.id || author1.username !== otherFound.username || author1.displayName !== otherFound.displayName || author1.iconURL !== otherFound.iconURL) {
                return false; // Authors are not the same
            }
        }

        if (checkUniqueFields) {
            if (author1.dontDisplay !== otherFound.dontDisplay || author1.reason !== otherFound.reason) {
                return false; // Unique fields are not the same
            }
        }
    }

    return true;
}