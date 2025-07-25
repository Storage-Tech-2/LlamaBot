import { GuildHolder } from "../GuildHolder.js";
import fs from "fs/promises";
import { ConfigManager } from "../config/ConfigManager.js";
import Path from "path";
import { AnyThreadChannel, AttachmentBuilder, ChannelType, ChatInputCommandInteraction, EmbedBuilder, ForumChannel, ForumLayoutType, GuildTextBasedChannel, Message, MessageFlags, Snowflake } from "discord.js";
import { ArchiveChannelReference, RepositoryConfigs } from "./RepositoryConfigs.js";
import { areAuthorsListEqual, areAuthorsSame, deepClone, escapeString, generateCommitMessage, getChangeIDs, getCodeAndDescriptionFromTopic, getGithubOwnerAndProject, reclassifyAuthors, splitCode, splitIntoChunks, truncateStringWithEllipsis } from "../utils/Util.js";
import { ArchiveEntry, ArchiveEntryData } from "./ArchiveEntry.js";
import { Submission } from "../submissions/Submission.js";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs.js";
import { ArchiveChannel, ArchiveEntryReference } from "./ArchiveChannel.js";
import { Lock } from "../utils/Lock.js";
import { PostEmbed } from "../embed/PostEmbed.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { simpleGit, SimpleGit } from "simple-git";
import { ArchiveComment } from "./ArchiveComments.js";
import { Author, AuthorType } from "../submissions/Author.js";
import { SubmissionStatus } from "../submissions/SubmissionStatus.js";
import { makeEntryReadMe } from "./ReadMeMaker.js";
import { analyzeAttachments, getAttachmentsFromMessage, getFileKey, processAttachments } from "../utils/AttachmentUtils.js";
export class RepositoryManager {
    private folderPath: string;
    private git?: SimpleGit;
    private configManager: ConfigManager;
    private lock: Lock = new Lock();
    private ignoreUpdatesFrom: Snowflake[] = [];
    private guildHolder: GuildHolder;
    constructor(guildHolder: GuildHolder, folderPath: string) {
        this.guildHolder = guildHolder;
        this.folderPath = folderPath;
        this.configManager = new ConfigManager(Path.join(folderPath, 'config.json'));
    }

    async init() {
        await this.lock.acquire();
        // try to access the folder, create it if it doesn't exist
        if (!await fs.access(this.folderPath).then(() => true).catch(() => false)) {
            await fs.mkdir(this.folderPath, { recursive: true });
        }
        this.git = simpleGit(this.folderPath)
            .init()
            .addConfig('user.name', 'llamabot-archiver[bot]')
            .addConfig('user.email', '217070326+llamabot-archiver[bot]@users.noreply.github.com')
            .addConfig('pull.rebase', 'false')

        await this.git;

        // check if gitignore exists, create it if it doesn't
        const gitignorePath = Path.join(this.folderPath, '.gitignore');
        if (!await fs.access(gitignorePath).then(() => true).catch(() =>
            false)) {
            await fs.writeFile(gitignorePath, '.DS_Store\n', 'utf-8');
            await this.git.add('.gitignore');
            await this.git.commit('Initial commit: add .gitignore');
        }


        // Load the config manager
        await this.configManager.loadConfig();

        // try pull
        try {
            await this.pull();
        } catch (e: any) {
            console.error("Error pulling from remote:", e.message);
        }

        try {
            await this.push();
        } catch (e: any) {
            console.error("Error pushing to remote:", e.message);
        }

        await this.lock.release();

        await this.getPostToSubmissionIndex();
    }

    getIndexPath() {
        return Path.join(this.folderPath, 'post_to_submission_index.json');
    }

    addToIgnoreUpdatesFrom(id: Snowflake) {
        if (!this.ignoreUpdatesFrom.includes(id)) {
            this.ignoreUpdatesFrom.push(id);
        }
    }

    removeFromIgnoreUpdatesFrom(id: Snowflake) {
        const index = this.ignoreUpdatesFrom.indexOf(id);
        if (index !== -1) {
            this.ignoreUpdatesFrom.splice(index, 1);
        }
    }

    public async iterateAllEntries(callback: (entry: ArchiveEntry, channelRef: ArchiveChannelReference, channel: ArchiveChannel) => Promise<void>) {
        const channelReferences = this.getChannelReferences();
        for (const channelRef of channelReferences) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            if (!archiveChannel) {
                console.warn(`Channel ${channelRef.name} (${channelRef.id}) not found in memory`);
                continue;
            }
            const entries = archiveChannel.getData().entries;
            for (const entryRef of entries) {
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);
                if (!entry) {
                    console.warn(`Entry ${entryRef.name} (${entryRef.code}) not found in memory`);
                    continue;
                }
                await callback(entry, channelRef, archiveChannel);
            }
        }
    }

    shouldIgnoreUpdates(id: Snowflake): boolean {
        return this.ignoreUpdatesFrom.includes(id);
    }


    async getPostToSubmissionIndex() {
        const filePath = this.getIndexPath();
        if (!await fs.access(filePath).then(() => true).catch(() => false)) {
            // If the file does not exist, create it
            await fs.writeFile(filePath, JSON.stringify({}, null, 2), 'utf-8');
            return {};
        } else {
            // If the file exists, read it
            const content = await fs.readFile(filePath, 'utf-8');
            try {
                return JSON.parse(content);
            } catch (e) {
                console.error("Error parsing post_to_submission_index.json:", e);
                return {};
            }
        }
    }

    async savePostToSubmissionIndex(index: any) {
        if (!this.git) {
            throw new Error("Git not initialized");
        }
        const filePath = this.getIndexPath();
        await fs.writeFile(filePath, JSON.stringify(index, null, 2), 'utf-8');
    }

    async getSubmissionIDByPostID(postID: Snowflake): Promise<Snowflake | null> {
        const index = await this.getPostToSubmissionIndex();
        if (index.hasOwnProperty(postID)) {
            return index[postID] as Snowflake;
        } else {
            // check all entries
            const channelReferences = this.getChannelReferences();
            for (const channelRef of channelReferences) {
                const channelPath = Path.join(this.folderPath, channelRef.path);
                const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
                const entries = archiveChannel.getData().entries;
                for (const entryRef of entries) {
                    const entryPath = Path.join(channelPath, entryRef.path);
                    const entry = await ArchiveEntry.fromFolder(entryPath);
                    if (entry) {
                        const post = entry.getData().post;
                        if (post && post.threadId === postID) {
                            await this.setSubmissionIDForPostID(postID, entry.getData().id); // Ensure the index is updated
                            return entry.getData().id; // Return the submission ID
                        }
                    }
                }
            }
            return null;
        }
    }

    async setSubmissionIDForPostID(postID: Snowflake, submissionID: Snowflake) {
        const index = await this.getPostToSubmissionIndex();
        const prevValue = index.hasOwnProperty(postID) ? index[postID] : null;
        if (prevValue === submissionID) {
            return; // No change needed
        }
        index[postID] = submissionID;
        await this.savePostToSubmissionIndex(index);
    }

    async deleteSubmissionIDForPostID(postID: Snowflake) {
        const index = await this.getPostToSubmissionIndex();
        if (index.hasOwnProperty(postID)) {
            delete index[postID];
            await this.savePostToSubmissionIndex(index);
        }
    }

    async pull() {
        if (!this.git) {
            throw new Error("Git not initialized");
        }
        await this.updateRemote();
        const branchName = await this.git.branchLocal().then(branch => branch.current);
        await this.git.pull('origin', branchName);
    }

    async updateRemote() {
        if (!this.git) {
            throw new Error("Git not initialized");
        }

        const remoteURL = this.guildHolder.getConfigManager().getConfig(GuildConfigs.GITHUB_REPO_URL);
        if (!remoteURL) {
            throw new Error("GitHub repository URL not set in guild configuration");
        }

        const { owner, project } = getGithubOwnerAndProject(remoteURL);
        if (!owner || !project) {
            throw new Error("Invalid GitHub repository URL");
        }

        const token = await this.guildHolder.getBot().getGithubInstallationToken(owner);


        const remotes = await this.git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        if (origin) {
            await this.git.removeRemote('origin');
        }

        await this.git.addRemote('origin', `https://x-access-token:${token}@github.com/${owner}/${project}.git`);
    }

    public getChannelReferences() {
        return this.configManager.getConfig(RepositoryConfigs.ARCHIVE_CHANNELS);
    }

    async setupArchives(channels: ForumChannel[]) {
        if (!this.git) {
            throw new Error("Git not initialized");
        }
        await this.lock.acquire();

        const reMapped: ArchiveChannelReference[] = [];
        for (const channel of channels.values()) {
            await channel.fetch();
            const { code, description } = getCodeAndDescriptionFromTopic(channel.topic || '');
            if (!code) {
                this.lock.release();
                throw new Error(`Channel ${channel.name} (${channel.id}) does not have a valid code in the topic.`);
            }
            reMapped.push({
                id: channel.id,
                name: channel.name,
                code,
                category: channel.parent?.name || '',
                path: `Archive/${code}_${escapeString(channel.name) || ''}`,
                description: description || 'No description'
            });
        }


        const existingChannels = this.getChannelReferences();
        const newChannels = reMapped.filter(c => !existingChannels.some(ec => ec.id === c.id));
        const removedChannels = existingChannels.filter(ec => !reMapped.some(c => c.id === ec.id));
        const modifiedChannels = reMapped.filter(c => {
            const existing = existingChannels.find(ec => ec.id === c.id);
            return existing && (existing.name !== c.name || existing.description !== c.description || existing.code !== c.code || existing.category !== c.category);
        });

        // First, remove any channels that no longer exist
        for (const channel of removedChannels) {
            const channelPath = Path.join(this.folderPath, channel.path);
            // Commit the removal
            for (const file of await fs.readdir(channelPath)) {
                const filePath = Path.join(channelPath, file);
                // recursive
                await fs.rm(filePath, { recursive: true, force: true });
            }
            await this.git.rm(channelPath);
            await this.git.commit(`Removed channel ${channel.name} (${channel.code})`);
        }

        // Then, add new channels
        for (const channel of newChannels) {
            const channelPath = Path.join(this.folderPath, channel.path);

            await fs.mkdir(channelPath, { recursive: true });

            // make new channel
            const newChannel = ArchiveChannel.newFromReference(channel, channelPath);
            await newChannel.save();


            // Commit the new channel
            await this.git.add(channelPath);
            await this.git.commit(`Added channel ${channel.name} (${channel.code})`);
        }

        // Finally, update modified channels
        for (const channel of modifiedChannels) {
            const oldChannel = existingChannels.find(ec => ec.id === channel.id);
            if (!oldChannel) continue;
            const oldPath = Path.join(this.folderPath, oldChannel.path);
            const newPath = Path.join(this.folderPath, channel.path);

            // Rename the folder if the path has changed
            if (oldPath !== newPath) {
                await this.git.mv(oldPath, newPath);
            }

            // check each post. Iterate through the files in the new path
            const channelInstance = await ArchiveChannel.fromFolder(newPath);
            if (!channelInstance) {
                throw new Error(`Channel ${channel.name} (${channel.id}) not found in memory`);
            }

            const entries = channelInstance.getData().entries;
            const newEntries: ArchiveEntryReference[] = [];
            for (const oldEntryRef of entries) {
                // Check if the file is a directory
                const newEntryRef: ArchiveEntryReference = {
                    ...oldEntryRef
                };

                newEntryRef.code = channel.code + oldEntryRef.code.replace(new RegExp(`^${oldChannel.code}`), '');
                newEntryRef.path = `${newEntryRef.code}_${escapeString(oldEntryRef.name || '')}`;

                const oldFolderPath = Path.join(newPath, oldEntryRef.path);
                const newFolderPath = Path.join(newPath, newEntryRef.path);
                // Rename
                if (oldFolderPath !== newFolderPath) {
                    await this.git.mv(oldFolderPath, newFolderPath);
                }

                // Load entry
                const entry = await ArchiveEntry.fromFolder(newFolderPath);
                if (!entry) {
                    throw new Error(`Entry ${oldEntryRef.name} (${oldEntryRef.code}) not found in memory`);
                }
                entry.getData().code = newEntryRef.code;

                // Rename attachment files
                for (const attachment of entry.getData().attachments) {
                    const newName = attachment.name.replace(new RegExp(`^${oldEntryRef.code}`), newEntryRef.code);
                    attachment.name = newName;

                    const oldPath = attachment.path || '';
                    // split the path to get the file name
                    const oldPathParts = oldPath.split('/');
                    const oldFileName = oldPathParts.pop() || '';
                    oldPathParts.push(oldFileName.replace(new RegExp(`^${oldEntryRef.code}`), newEntryRef.code));
                    const newPath = oldPathParts.join("/");
                    if (oldPath !== newPath) {
                        const fullOldPath = Path.join(newFolderPath, oldPath);
                        const fullNewPath = Path.join(newFolderPath, newPath);
                        await this.git.mv(fullOldPath, fullNewPath);
                        attachment.path = newPath;
                    }
                }

                // Save the entry
                await this.git.add(entry.getDataPath());
                await entry.save();
                newEntries.push(newEntryRef);
                //await this.git.add(await this.updateEntryReadme(entry));

                // update submission
                //await this.addOrUpdateEntryFromData(this.guildHolder, entry.getData(), channel.id, false, false, async () => {});
            }

            channelInstance.getData().name = channel.name;
            channelInstance.getData().category = channel.category;
            channelInstance.getData().description = channel.description;
            channelInstance.getData().code = channel.code;
            channelInstance.getData().entries = newEntries;
            await channelInstance.save();

            if (oldPath !== newPath) {
                // republish everything
                for (const entryRef of newEntries) {
                    const entryPath = Path.join(newPath, entryRef.path);
                    const entry = await ArchiveEntry.fromFolder(entryPath);
                    if (!entry) {
                        throw new Error(`Entry ${entryRef.name} (${entryRef.code}) not found in memory`);
                    }
                    // republish the entry
                    await this.addOrUpdateEntryFromData(this.guildHolder, entry.getData(), channel.id, false, false, async () => { });
                    // update submission
                    const submission = await this.guildHolder.getSubmissionsManager().getSubmission(entry.getData().id);
                    if (submission) {
                        const reservedCodes = submission.getConfigManager().getConfig(SubmissionConfigs.RESERVED_CODES);
                        // Check if the code is already reserved
                        if (!reservedCodes.includes(entry.getData().code)) {
                            reservedCodes.push(entry.getData().code);
                            submission.getConfigManager().setConfig(SubmissionConfigs.RESERVED_CODES, reservedCodes);
                        }
                        await submission.save();
                    }
                }
            }

            // Commit the changes
            let msg;
            if (oldChannel.code !== channel.code) {
                msg = `Changed code for channel ${oldChannel.name} from ${oldChannel.code} to ${channel.code}`;
            } else if (oldChannel.name !== channel.name) {
                msg = `Renamed channel ${oldChannel.name} to ${channel.name} (${channel.code})`;
            } else {
                msg = `Updated channel ${oldChannel.name} (${channel.code})`;
            }
            await this.git.add(newPath);
            await this.git.commit(msg);
        }

        // Finally, save the new config
        this.configManager.setConfig(RepositoryConfigs.ARCHIVE_CHANNELS, reMapped);
        await this.save();

        // Add config if it doesn't exist
        await this.git.add(Path.join(this.folderPath, 'config.json'));
        await this.git.commit('Updated repository configuration');
        try {
            await this.push();
        } catch (e: any) {
            console.error("Error pushing to remote:", e.message);
        }
        await this.lock.release();
    }

    async findEntryBySubmissionId(submissionId: string): Promise<null | {
        channelRef: ArchiveChannelReference,
        channel: ArchiveChannel,
        entry: ArchiveEntry,
        entryRef: ArchiveEntryReference,
        entryIndex: number
    }> {
        const channelReferences = this.getChannelReferences();
        for (const channelRef of channelReferences) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            const entries = archiveChannel.getData().entries;
            const entryIndex = entries.findIndex(e => e.id === submissionId);
            if (entryIndex !== -1) {
                const entryRef = entries[entryIndex];
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);
                if (!entry) {
                    continue; // Skip if entry could not be loaded
                }
                return {
                    channelRef,
                    channel: archiveChannel,
                    entry,
                    entryRef,
                    entryIndex
                };
            }
        }

        return null;
    }

    async findEntryBySubmissionCode(submissionCode: string): Promise<null | {
        channelRef: ArchiveChannelReference,
        channel: ArchiveChannel,
        entry: ArchiveEntry,
        entryRef: ArchiveEntryReference,
        entryIndex: number
    }> {
        const channelReferences = this.getChannelReferences();
        for (const channelRef of channelReferences) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            const entries = archiveChannel.getData().entries;
            const entryIndex = entries.findIndex(e => e.code === submissionCode);
            if (entryIndex !== -1) {
                const entryRef = entries[entryIndex];
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);
                if (!entry) {
                    continue; // Skip if entry could not be loaded
                }
                return {
                    channelRef,
                    channel: archiveChannel,
                    entry,
                    entryRef,
                    entryIndex
                };
            }
        }

        return null;
    }

    async addOrUpdateEntryFromSubmission(submission: Submission, forceNew: boolean): Promise<{ oldEntryData?: ArchiveEntryData, newEntryData: ArchiveEntryData }> {

        if (!this.git) {
            throw new Error("Git not initialized");
        }

        const archiveChannelId = submission.getConfigManager().getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        if (!archiveChannelId) {
            throw new Error("Submission does not have an archive channel set");
        }

        const archiveChannelRef = this.getChannelReferences().find(c => c.id === archiveChannelId);
        if (!archiveChannelRef) {
            throw new Error("Archive channel reference not found");
        }

        // acquire lock
        await this.lock.acquire();
        let submissionChannel: GuildTextBasedChannel | null = null;
        let entryData: ArchiveEntryData | null = null;
        try {
            const channelPath = Path.join(this.folderPath, archiveChannelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);


            // Find old entry if it exists
            // const existing = await this.findEntryBySubmissionId(submission.getId());
            const reservedCodes = submission.getConfigManager().getConfig(SubmissionConfigs.RESERVED_CODES);
            // archiveChannel.getData().code + (++archiveChannel.getData().currentCodeId).toString().padStart(3, '0')
            // check reserved codes
            let newCode = '';
            for (const code of reservedCodes) {
                // get channel code XXX001
                const { channelCode } = splitCode(code);
                if (channelCode === archiveChannelRef.code) {
                    // If the code is reserved, use it
                    newCode = code;

                    if (!archiveChannel.getData().entries.find(e => e.code === newCode && submission.getId() !== e.id)) {
                        break;
                    }
                }
            }

            if (!newCode) {
                // If no reserved code was found, generate a new code
                newCode = archiveChannelRef.code + (++archiveChannel.getData().currentCodeId).toString().padStart(3, '0');
            }

            // Check if the code already exists in the channel
            for (let i = 0; i < archiveChannel.getData().entries.length; i++) {
                const existingCodeEntry = archiveChannel.getData().entries.find(e => e.code === newCode);
                if (existingCodeEntry && submission.getId() !== existingCodeEntry.id) {
                    newCode = archiveChannelRef.code + (++archiveChannel.getData().currentCodeId).toString().padStart(3, '0');
                } else {
                    break; // Found a unique code
                }
            }

            await archiveChannel.save();

            // Add the new code to the reserved codes if it doesn't already exist
            if (!reservedCodes.includes(newCode)) {
                reservedCodes.push(newCode);
                submission.getConfigManager().setConfig(SubmissionConfigs.RESERVED_CODES, reservedCodes);
            }

            const revisionReference = submission.getRevisionsManager().getCurrentRevision();
            if (!revisionReference) {
                throw new Error("Submission does not have a current revision");
            }
            const revision = await submission.getRevisionsManager().getRevisionById(revisionReference.id);
            if (!revision) {
                throw new Error("Submission revision not found");
            }

            submissionChannel = await submission.getSubmissionChannel();
            if (!submissionChannel) {
                throw new Error("Submission channel not found");
            }

            const config = submission.getConfigManager();

            config.setConfig(SubmissionConfigs.NAME, submissionChannel.name);

            entryData = deepClone({
                id: submission.getId(),
                name: config.getConfig(SubmissionConfigs.NAME),
                code: newCode,
                authors: await reclassifyAuthors(this.guildHolder, config.getConfig(SubmissionConfigs.AUTHORS) || []),
                endorsers: await reclassifyAuthors(this.guildHolder, config.getConfig(SubmissionConfigs.ENDORSERS)),
                tags: config.getConfig(SubmissionConfigs.TAGS) || [],
                images: submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) || [],
                attachments: submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) || [],
                records: revision.records,
                timestamp: Date.now(),
                post: undefined
            });

            if (!submissionChannel || !entryData) {
                throw new Error("Failed to get submission channel or entry data");
            }
            const result = await this.addOrUpdateEntryFromData(submission.getGuildHolder(), entryData, archiveChannelId, forceNew, false, async (entryData, imageFolder, attachmentFolder) => {
                // remove all images and attachments that exist in the folder.
                await fs.mkdir(imageFolder, { recursive: true });
                await fs.mkdir(attachmentFolder, { recursive: true });

                for (const file of await fs.readdir(imageFolder)) {
                    const filePath = Path.join(imageFolder, file);
                    const stat = await fs.lstat(filePath);
                    if (stat.isFile()) {
                        await fs.unlink(filePath);
                    }
                }
                for (const file of await fs.readdir(attachmentFolder)) {
                    const filePath = Path.join(attachmentFolder, file);
                    const stat = await fs.lstat(filePath);
                    if (stat.isFile()) {
                        await fs.unlink(filePath);
                    }
                }

                // Copy over all attachments and images
                for (const image of entryData.images) {
                    const sourcePath = Path.join(submission.getProcessedImagesFolder(), getFileKey(image, 'png'));
                    const dest = image.name.split('.');
                    if (dest.length > 1) {
                        dest.pop();
                    }
                    const destKeyOrig = escapeString(dest.join('.'));
                    let destKey = destKeyOrig;

                    // Check for duplicate file names
                    for (let i = 1; i < 15; i++) {
                        if (await fs.access(Path.join(imageFolder, `${destKey}.png`)).then(() => true).catch(() => false)) {
                            destKey = `${destKeyOrig}_${i}`;
                        }
                    }

                    const destPath = Path.join(imageFolder, `${destKey}.png`);
                    await fs.copyFile(sourcePath, destPath);
                    image.path = `images/${destKey}.png`;
                    image.name = destKey + '.png'; // Update the name to the new key
                }

                for (const attachment of entryData.attachments) {
                    const dest = attachment.name.split('.');
                    let ext = dest.length > 1 ? escapeString(dest.pop() || '') : '';
                    if (!attachment.canDownload) {
                        ext = 'url';
                    }

                    const destKeyOrig = entryData.code + '_' + escapeString(dest.join('.'));
                    let destKey = destKeyOrig;
                    for (let i = 1; i < 15; i++) {
                        if (await fs.access(Path.join(attachmentFolder, `${destKey}${ext ? '.' + ext : ''}`)).then(() => true).catch(() => false)) {
                            destKey = `${destKeyOrig}_${i}`;
                        }
                    }

                    const newKey = `${destKey}${ext ? '.' + ext : ''}`;
                    const sourcePath = Path.join(submission.getAttachmentFolder(), getFileKey(attachment));
                    const destPath = Path.join(attachmentFolder, newKey);
                    attachment.path = `attachments/${newKey}`;
                    attachment.name = newKey; // Update the name to the new key
                    if (!attachment.canDownload) {
                        await fs.writeFile(destPath, attachment.url || '', 'utf-8');
                    } else {
                        await fs.copyFile(sourcePath, destPath);
                    }
                }

            });

            const newEntryData = result.newEntryData;
            const oldEntryData = result.oldEntryData;
            if (oldEntryData) {
                await this.git.commit(`${newEntryData.code}: ${generateCommitMessage(oldEntryData, newEntryData)}`);
            } else {
                await this.git.commit(`Added entry ${newEntryData.name} (${newEntryData.code}) to channel ${archiveChannel.getData().name} (${archiveChannel.getData().code})`);
            }
            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }
            this.lock.release();
            return result;
        } catch (e: any) {
            await this.lock.release();
            throw e;
        }
    }


    async addOrUpdateEntryFromData(guildHolder: GuildHolder, newEntryData: ArchiveEntryData, archiveChannelId: Snowflake, forceNew: boolean, reanalyzeAttachments: boolean, moveAttachments: (entryData: ArchiveEntryData, imageFolder: string, attachmentFolder: string) => Promise<void>): Promise<{ oldEntryData?: ArchiveEntryData, newEntryData: ArchiveEntryData }> {
        // clone entryData
        newEntryData = deepClone(newEntryData);

        if (!this.git) {
            throw new Error("Git not initialized");
        }

        this.addToIgnoreUpdatesFrom(newEntryData.id);

        if (!archiveChannelId) {
            throw new Error("Submission does not have an archive channel set");
        }


        const archiveChannelRef = this.getChannelReferences().find(c => c.id === archiveChannelId);
        if (!archiveChannelRef) {
            throw new Error("Archive channel reference not found");
        }

        const archiveChannelDiscord = await guildHolder.getGuild().channels.fetch(archiveChannelId).catch(() => null);
        if (!archiveChannelDiscord || archiveChannelDiscord.type !== ChannelType.GuildForum) {
            throw new Error('Archive channel not found or is not a forum channel');
        }

        const uploadChannel = await guildHolder.getGuild().channels.fetch(newEntryData.id).catch(() => null);
        if (!uploadChannel || !uploadChannel.isTextBased()) {
            throw new Error('Upload channel not found or is not text based');
        }

        const channelPath = Path.join(this.folderPath, archiveChannelRef.path);
        const archiveChannel = await ArchiveChannel.fromFolder(channelPath);


        // Find old entry if it exists
        const existing = await this.findEntryBySubmissionId(newEntryData.id);
        const isSameChannel = existing && existing.channelRef.id === archiveChannelId;

        const entryRef: ArchiveEntryReference = {
            id: newEntryData.id,
            name: newEntryData.name,
            code: newEntryData.code,
            timestamp: newEntryData.timestamp,
            path: `${newEntryData.code}_${escapeString(newEntryData.name) || ''}`,
        }

        const entryFolderPath = Path.join(channelPath, entryRef.path);

        if (!newEntryData.post) {
            newEntryData.post = {
                threadId: '',
                forumId: archiveChannelId,
                continuingMessageIds: [],
                threadURL: '',
                uploadMessageId: ''
            }
        }

        let wasArchived = false;
        if (existing) {
            const existingFolder = Path.join(existing.channel.getFolderPath(), existing.entryRef.path);
            if (existingFolder !== entryFolderPath) {
                // If the folder is different, we need to rename the old folder
                await this.git.mv(existingFolder, entryFolderPath);
            }

            if (!isSameChannel) {
                // If the channel is different, we need to remove the old entry from the old channel
                existing.channel.getData().entries.splice(existing.entryIndex, 1);
                await existing.channel.save();
                await this.git.add(existing.channel.getDataPath());

                // Also remove old discord post if it exists
                const post = existing.entry.getData().post;
                if (post) {
                    const publishForumId = post.forumId;
                    const publishForum = await guildHolder.getGuild().channels.fetch(publishForumId).catch(() => null);
                    if (publishForum && publishForum.type === ChannelType.GuildForum) {
                        const thread = await publishForum.threads.fetch(post.threadId).catch(() => null);
                        if (thread) {
                            if (thread.archived) {
                                wasArchived = true;
                            }
                            await thread.delete('Entry moved to a different channel');
                        }
                    }
                }
            } else {
                // Check if images are the same
                const existingImages = existing.entry.getData().images;
                const newImages = newEntryData.images;
                if (!getChangeIDs(existingImages, newImages) && !forceNew) { // no problem
                    newEntryData.post = existing.entry.getData().post || newEntryData.post;
                } else {
                    // If images are different, we need to delete the thread
                    const post = existing.entry.getData().post;
                    if (post) {
                        const publishForumId = post.forumId;
                        const publishForum = await guildHolder.getGuild().channels.fetch(publishForumId).catch(() => null);
                        if (publishForum && publishForum.type === ChannelType.GuildForum) {
                            const thread = await publishForum.threads.fetch(post.threadId).catch(() => null);
                            if (thread) {
                                if (thread.archived) {
                                    wasArchived = true;
                                }
                                await thread.delete('Entry images updated');
                            }
                        }
                    }
                }
            }
        }

        if (existing) {
            const existingData = existing.entry.getData();
            if (getChangeIDs(existingData.attachments, newEntryData.attachments) || existingData.code !== newEntryData.code) {
                newEntryData.post.uploadMessageId = '';
            } else if (existingData.post) {
                newEntryData.post.uploadMessageId = existingData.post.uploadMessageId;
            } else {
                newEntryData.post.uploadMessageId = '';
            }
        } else {
            newEntryData.post.uploadMessageId = '';
        }

        await fs.mkdir(entryFolderPath, { recursive: true });

        const entry = new ArchiveEntry(newEntryData, entryFolderPath);

        const imageFolder = Path.join(entryFolderPath, 'images');
        const attachmentFolder = Path.join(entryFolderPath, 'attachments');

        await moveAttachments(newEntryData, imageFolder, attachmentFolder);

        if (reanalyzeAttachments) {
            await analyzeAttachments(newEntryData.attachments, entryFolderPath);
        }

        if (existing && isSameChannel) {
            archiveChannel.getData().entries[existing.entryIndex] = entryRef;
        } else {
            // New entry
            archiveChannel.getData().entries.push(entryRef);
        }

        let thread;
        if (newEntryData.post && newEntryData.post.threadId) {
            thread = await archiveChannelDiscord.threads.fetch(newEntryData.post.threadId).catch(() => null);
            // unarchive the thread if it exists
            if (thread && thread.archived) {
                await thread.setArchived(false);
                wasArchived = true;
            }
        }


        // First, upload attachments
        const entryPathPart = `${archiveChannelRef.path}/${entryRef.path}`;
        const attachmentUpload = await PostEmbed.createAttachmentUpload(entryFolderPath, newEntryData);

        const hasUploadAttachments = attachmentUpload.files.length > 0;
        let uploadMessage = null;
        if (newEntryData.post && newEntryData.post.uploadMessageId && hasUploadAttachments) {
            uploadMessage = await uploadChannel.messages.fetch(newEntryData.post.uploadMessageId).catch(() => null);
        }

        let uploadArchived = false;
        if (!uploadMessage && hasUploadAttachments) {
            if (uploadChannel.isThread() && uploadChannel.archived) {
                uploadArchived = true;
                await uploadChannel.setArchived(false);
            }

            uploadMessage = await uploadChannel.send({
                content: attachmentUpload.content,
                files: attachmentUpload.files,
            });
            newEntryData.post.uploadMessageId = uploadMessage.id;
        }

        // get comments
        const commentsFile = Path.join(entryFolderPath, 'comments.json');
        let comments: ArchiveComment[] = [];
        try {
            comments = JSON.parse(await fs.readFile(commentsFile, 'utf-8')) as ArchiveComment[];
        }
        catch (e: any) {
            if (e.code !== 'ENOENT') {
                console.error("Error reading comments file:", e);
                throw e;
            }
        }


        const branchName = await this.git.branchLocal().then(branch => branch.current);

        // Next, create the post
        const message = PostEmbed.createInitialMessage(this.guildHolder, newEntryData, entryPathPart);
        const messageChunks = splitIntoChunks(message, 2000);

        const hasAttachments = newEntryData.attachments.length > 0;
        if (hasAttachments) {
            const attachmentMessageChunks = splitIntoChunks(await PostEmbed.createAttachmentMessage(this.guildHolder, newEntryData, branchName, entryPathPart, uploadMessage), 2000);
            messageChunks.push(...attachmentMessageChunks);
        }

        let wasThreadCreated = false;
        if (!thread) {
            newEntryData.post.threadId = '';
            newEntryData.post.threadURL = '';
            newEntryData.post.continuingMessageIds = [];
            const isGalleryView = archiveChannelDiscord.defaultForumLayout === ForumLayoutType.GalleryView;
            const files = await PostEmbed.createImageFiles(newEntryData, this.folderPath, entryPathPart, isGalleryView);
            thread = await archiveChannelDiscord.threads.create({
                message: {
                    content: `Pending...`,
                    files: files.files,
                    flags: [MessageFlags.SuppressEmbeds, MessageFlags.SuppressNotifications]
                },
                name: newEntryData.code + ' ' + newEntryData.name,
                appliedTags: newEntryData.tags.map(tag => tag.id).filter(tagId => archiveChannelDiscord.availableTags.some(t => t.id === tagId)).slice(0, 5),
            })

            // delete old files
            for (const file of files.paths) {
                await fs.unlink(file).catch(() => { });
            }

            wasThreadCreated = true;
        } else {
            await thread.setAppliedTags(newEntryData.tags.map(tag => tag.id).filter(tagId => archiveChannelDiscord.availableTags.some(t => t.id === tagId)).slice(0, 5));
        }

        newEntryData.post.threadId = thread.id;
        newEntryData.post.threadURL = thread.url;

        if (newEntryData.name !== thread.name) {
            await thread.edit({
                name: newEntryData.code + ' ' + newEntryData.name
            })
        }

        const initialMessage = await thread.fetchStarterMessage().catch(() => null);
        if (!initialMessage) {
            throw new Error('Initial message not found in thread');
        }

        // Detect if thread needs to be refreshed
        const continuingMessageIds = newEntryData.post.continuingMessageIds || [];
        const shouldRefreshThread = (messageChunks.length > 1 + continuingMessageIds.length) && comments && comments.length > 0;
        if (shouldRefreshThread) {
            // Delete all previous messages in the thread that are not part of the continuing messages
            for (let i = 0; i < 100; i++) {
                const messages = await thread.messages.fetch({ limit: 100 });
                let deletedCount = 0;
                for (const message of messages.values()) {
                    if (message.id !== initialMessage.id && !continuingMessageIds.includes(message.id)) {
                        await message.delete();
                        deletedCount++;
                    }
                }
                if (deletedCount === 0) {
                    break; // No more messages to delete
                }
            }
            newEntryData.post.continuingMessageIds = []; // Reset continuing message IDs to force re-creation
        }

        // Delete excess messages if they exist
        if (continuingMessageIds.length > messageChunks.length - 1) {
            const excessMessageIds = continuingMessageIds.slice(messageChunks.length - 1);
            for (const messageId of excessMessageIds) {
                try {
                    const messageInstance = await thread.messages.fetch(messageId).catch(() => null);
                    if (messageInstance) {
                        await messageInstance.delete();
                    }
                } catch (e: any) {
                    console.error(`Error deleting message ${messageId} in thread ${thread.id}:`, e.message);
                }
            }
            continuingMessageIds.splice(messageChunks.length - 1); // Keep only the messages that are still needed
        }

        // Create new messages if needed
        for (let i = continuingMessageIds.length; i < messageChunks.length - 1; i++) {
            const message = await thread.send({
                content: 'Pending...',
                flags: [MessageFlags.SuppressEmbeds, MessageFlags.SuppressNotifications]
            });
            newEntryData.post.continuingMessageIds.push(message.id);
        }

        // Update the initial message with the first chunk
        if (messageChunks.length > 0) {
            await initialMessage.edit({
                content: messageChunks[0],
                flags: [MessageFlags.SuppressEmbeds]
            });
        }

        // If there are more chunks, send them as separate messages
        for (let i = 1; i < messageChunks.length; i++) {
            const messageId = newEntryData.post.continuingMessageIds[i - 1];
            const message = await thread.messages.fetch(messageId).catch(() => null);
            if (!message) {
                throw new Error(`Message with ID ${messageId} not found in thread ${thread.id}`);
            }
            await message.edit({
                content: messageChunks[i],
                flags: [MessageFlags.SuppressEmbeds]
            });
        }

        if (wasThreadCreated || shouldRefreshThread) { // check if there are comments to post
            if (comments.length > 0 && thread.parent) {
                // make webhook
                const threadWebhook = await thread.parent.createWebhook({
                    name: 'LlamaBot Archiver'
                });



                for (const comment of comments) {
                    const author = (await reclassifyAuthors(this.guildHolder, [comment.sender]))[0];
                    comment.sender = author;

                    const files: AttachmentBuilder[] = [];
                    if (comment.attachments.length > 0) {
                        for (const attachment of comment.attachments) {
                            if (!attachment.canDownload || !attachment.path || attachment.contentType === 'discord') {
                                continue; // Skip attachments that cannot be downloaded or have no path
                            }
                            const attachmentPath = Path.join(entryFolderPath, attachment.path);
                            if (await fs.access(attachmentPath).then(() => true).catch(() => false)) {
                                const file = new AttachmentBuilder(attachmentPath);
                                file.setName(attachment.name);
                                file.setDescription(attachment.description || '');
                                files.push(file);
                            }
                        }
                    }

                    const commentMessage = await threadWebhook.send({
                        content: truncateStringWithEllipsis(comment.content, 2000),
                        username: author.displayName || author.username || 'Unknown Author',
                        avatarURL: author.iconURL || undefined,
                        files: files,
                        threadId: thread.id,
                        flags: [MessageFlags.SuppressNotifications]
                    });
                    comment.id = commentMessage.id;
                }
                // Save comments back to the file
                await fs.writeFile(commentsFile, JSON.stringify(comments, null, 2), 'utf-8');
                await this.git.add(commentsFile);
                await threadWebhook.delete();
            }

        }

        if (wasArchived) {
            await thread.setArchived(true, 'Thread was previously archived');
        }

        if (uploadArchived && uploadChannel.isThread()) {
            await uploadChannel.setArchived(true, 'Upload thread was previously archived');
        }

        await entry.save();
        await archiveChannel.save();
        await this.git.add(archiveChannel.getDataPath());

        await this.git.add(await this.updateEntryReadme(entry));

        await this.git.add(entryFolderPath);
        await this.git.add(channelPath); // to update currentCodeId and entries

        await this.setSubmissionIDForPostID(thread.id, newEntryData.id);
        this.removeFromIgnoreUpdatesFrom(newEntryData.id);
        return {
            oldEntryData: existing ? existing.entry.getData() : undefined,
            newEntryData: entry.getData()
        }

    }
    async retractEntry(submission: Submission, reason: string): Promise<ArchiveEntryData> {
        if (!this.git) {
            throw new Error("Git not initialized");
        }
        await this.lock.acquire();
        this.addToIgnoreUpdatesFrom(submission.getId());
        try {
            // Find archived entry in all channels
            const found = await this.findEntryBySubmissionId(submission.getId());
            if (!found) {
                throw new Error(`Submission ${submission.getId()} not found in any archive channel`);
            }
            const { channel: foundChannel, entry: foundEntry, entryIndex: foundEntryIndex } = found;
            const entryData = foundEntry.getData();
            const entryPath = foundEntry.getFolderPath();

            // Remove all files inside the entry folder
            const files = [];
            const stack = [entryPath];
            while (stack.length > 0) {
                const currentPath = stack.pop();
                if (!currentPath) continue;
                const entries = await fs.readdir(currentPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name === '.DS_Store') {
                        // delete .DS_Store files
                        await fs.unlink(Path.join(currentPath, entry.name));
                        continue; // Skip .DS_Store files
                    }
                    const fullPath = Path.join(currentPath, entry.name);
                    if (entry.isDirectory()) {
                        stack.push(fullPath);
                    } else {
                        files.push(fullPath);
                    }
                }
            }

            await this.git.rm(files);

            // delete folder
            await fs.rm(entryPath, { recursive: true, force: true });

            foundChannel.getData().entries.splice(foundEntryIndex, 1);
            await foundChannel.save();
            await this.git.add(foundChannel.getDataPath());

            // Commit the removal
            await this.git.commit(`Retracted entry ${entryData.name} (${entryData.code}) from channel ${foundChannel.getData().name} (${foundChannel.getData().code})\nReason: ${reason || 'No reason provided'}`);

            // Now post to discord
            await this.removeDiscordPost(entryData, submission, reason);

            // Remove post
            submission.getConfigManager().setConfig(SubmissionConfigs.POST, null);
            await submission.save();
            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }


            await this.deleteSubmissionIDForPostID(entryData.post?.threadId || '');
            this.removeFromIgnoreUpdatesFrom(submission.getId());
            this.lock.release();
            return entryData;
        } catch (e) {
            this.removeFromIgnoreUpdatesFrom(submission.getId());
            this.lock.release();
            throw e;
        }
    }

    async removeDiscordPost(entryData: ArchiveEntryData, submission: Submission, reason?: string): Promise<void> {
        if (!entryData.post) {
            return; // No post to remove
        }

        const publishForumId = entryData.post.forumId;
        const publishForum = await submission.getGuildHolder().getGuild().channels.fetch(publishForumId).catch(() => null);
        if (!publishForum || publishForum.type !== ChannelType.GuildForum) {
            return; // Publish forum not found or is not a forum channel
        }
        const thread = await publishForum.threads.fetch(entryData.post.threadId).catch(() => null);
        if (!thread) {
            return; // Thread not found in publish forum
        }

        await thread.delete(reason || 'No reason provided').catch(e => {
            console.error("Error deleting thread:", e);
        });
    }


    async push() {
        if (!this.git) {
            return;
        }
        await this.updateRemote();

        const branchName = await this.git.branchLocal().then(branch => branch.current);
        await this.git.push(['-u', 'origin', branchName]);
    }

    async save() {
        await this.configManager.saveConfig();
    }

    public getConfigManager(): ConfigManager {
        return this.configManager;
    }



    public async handlePostOrUpdateMessage(message: Message) {
        const postId = message.channel.id;

        if (!this.git) {
            return;
        }


        const submissionId = await this.getSubmissionIDByPostID(postId);
        if (!submissionId || this.shouldIgnoreUpdates(submissionId)) {
            return;
        }


        await this.lock.acquire();
        try {

            const found = await this.findEntryBySubmissionId(submissionId);
            if (!found) {
                throw new Error(`No entry found for submission ID ${submissionId}`);
            }

            const content = message.content;
            const attachments = getAttachmentsFromMessage(message);

            const entryPath = found.entry.getFolderPath();

            const commentsFile = Path.join(entryPath, 'comments.json');
            let comments: ArchiveComment[] = [];

            try {
                comments = JSON.parse(await fs.readFile(commentsFile, 'utf-8')) as ArchiveComment[];
            } catch (e: any) {
                if (e.code !== 'ENOENT') {
                    console.error("Error reading comments file:", e);
                    this.lock.release();
                    return;
                }
                await fs.writeFile(commentsFile, JSON.stringify([], null, 2), 'utf-8');
            }

            // Check if the comment already exists
            const existingCommentIndex = comments.findIndex(c => c.id === message.id);
            const existingComment = existingCommentIndex !== -1 ? comments[existingCommentIndex] : null;

            // Check if things have changed
            if (existingComment && existingComment.content === content && !getChangeIDs(existingComment.attachments, attachments)) {
                // No changes, nothing to do
                this.lock.release();
                return;
            }

            const commentsAttachmentFolder = Path.join(entryPath, 'comments_attachments');
            if (existingComment && existingComment.attachments.length > 0) {
                for (const attachment of existingComment.attachments) {
                    const attachmentPath = Path.join(commentsAttachmentFolder, getFileKey(attachment));
                    if (attachment.canDownload && !attachments.some(a => a.id === attachment.id)) {
                        await this.git.rm(attachmentPath);
                    }
                }
            }

            if (attachments.length > 0) {
                try {
                    await fs.mkdir(commentsAttachmentFolder, { recursive: true });
                    await processAttachments(attachments, commentsAttachmentFolder, this.guildHolder.getBot(), false);
                    for (const attachment of attachments) {
                        const attachmentPath = Path.join(commentsAttachmentFolder, getFileKey(attachment));
                        if (attachment.canDownload) {
                            attachment.path = `comments_attachments/${getFileKey(attachment)}`;
                            await this.git.add(attachmentPath);
                        }
                    }
                } catch (e: any) {
                    console.error("Error processing attachments:", e);
                }

            }

            const newComment: ArchiveComment = {
                id: message.id,
                sender: {
                    type: AuthorType.DiscordInGuild,
                    id: message.author.id,
                    username: message.author.username,
                    displayName: message.member?.displayName || undefined,
                    iconURL: message.author.displayAvatarURL()
                },
                content: content,
                attachments: attachments,
                timestamp: Date.now()
            }

            if (existingComment) {
                // Update existing comment
                comments[existingCommentIndex] = newComment;
            } else {
                // Add new comment
                comments.push(newComment);
            }
            await fs.writeFile(commentsFile, JSON.stringify(comments, null, 2), 'utf-8');
            await this.git.add(commentsFile);
            await this.git.add(await this.updateEntryReadme(found.entry));

            if (existingComment) {
                await this.git.commit(`Updated comment by ${message.member?.displayName} on ${found.entry.getData().code}`);
            } else {
                await this.git.commit(`Added ${message.member?.displayName}'s comment to ${found.entry.getData().code}`);
            }

            // check submission
            try {
                const submission = await this.guildHolder.getSubmissionsManager().getSubmission(submissionId);
                if (submission) {
                    // send message to the user
                    const channel = await submission.getSubmissionChannel();
                    if (channel) {



                        const embed = new EmbedBuilder()
                            .setTitle(`Comment ${existingComment ? 'Updated' : 'Added'}`)
                            .setURL(message.url)
                            .setColor(existingComment ? '#ffa500' : '#00ff00')
                            .setAuthor({
                                name: newComment.sender.displayName || newComment.sender.username || 'Unknown Author',
                                iconURL: newComment.sender.iconURL || undefined,
                            })
                            .setDescription(newComment.content)
                            .setTimestamp(newComment.timestamp ? new Date(newComment.timestamp) : undefined);
                        if (newComment.attachments.length > 0) {
                            embed.addFields({
                                name: 'Attachments',
                                value: truncateStringWithEllipsis(newComment.attachments.map(a => a.name).join(', '), 1024)
                            });
                        }
                        channel.send({
                            flags: [MessageFlags.SuppressNotifications],
                            embeds: [embed],
                        });
                    }
                }
            } catch (e: any) {
                console.error("Error updating submission:", e.message);
            }

            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }
        } catch (e) {
            console.error("Error handling post message:", e);
        }
        this.lock.release();
    }

    public async handlePostMessageDelete(message: Message) {

        if (!this.git) {
            throw new Error("Git not initialized");
        }

        const postId = message.channelId;
        const submissionId = await this.getSubmissionIDByPostID(postId);
        if (!submissionId || this.shouldIgnoreUpdates(submissionId)) {
            return;
        }

        await this.lock.acquire();
        try {
            const found = await this.findEntryBySubmissionId(submissionId);
            if (!found) {
                return;
            }

            const entryPath = found.entry.getFolderPath();

            const commentsFile = Path.join(entryPath, 'comments.json');

            let comments: ArchiveComment[] = [];
            try {
                comments = JSON.parse(await fs.readFile(commentsFile, 'utf-8')) as ArchiveComment[];
            } catch (e) {
            }

            const deletedCommentIndex = comments.findIndex(c => c.id === message.id);
            if (deletedCommentIndex === -1) {
                return;
            }

            const deletedComment = comments[deletedCommentIndex];


            if (deletedComment.attachments.length > 0) {
                const commentsAttachmentFolder = Path.join(entryPath, 'comments_attachments');

                for (const attachment of deletedComment.attachments) {
                    const attachmentPath = Path.join(commentsAttachmentFolder, getFileKey(attachment));
                    if (attachment.canDownload) {
                        try {
                            await this.git.rm(attachmentPath);
                        } catch (e: any) {
                        }
                    }
                }
            }
            comments.splice(deletedCommentIndex, 1);

            // check if there are any attachments left
            const hasAnyAttachmentsLeft = comments.some(c => c.attachments.filter(a => a.canDownload).length > 0);
            if (!hasAnyAttachmentsLeft) {
                // If no attachments left, delete the comments attachments folder
                const commentsAttachmentFolder = Path.join(entryPath, 'comments_attachments');
                // check if folder exists
                if (await fs.access(commentsAttachmentFolder).then(() => true).catch(() => false)) {

                    for (const file of await fs.readdir(commentsAttachmentFolder)) {
                        const filePath = Path.join(commentsAttachmentFolder, file);
                        const stat = await fs.lstat(filePath);
                        if (stat.isFile()) {
                            await fs.unlink(filePath);
                        }
                    }
                    try {
                        await this.git.rm(commentsAttachmentFolder);
                    } catch (e: any) {
                    }
                }
            }

            if (comments.length === 0) {
                // If no comments left, delete the comments file
                await this.git.rm(commentsFile);
            } else {
                await fs.writeFile(commentsFile, JSON.stringify(comments, null, 2), 'utf-8');
                await this.git.add(commentsFile);
            }

            await this.git.add(await this.updateEntryReadme(found.entry));
            await this.git.commit(`Deleted ${deletedComment.sender?.displayName}'s comment from ${found.entry.getData().code}`);

            // check submission
            try {
                const submission = await this.guildHolder.getSubmissionsManager().getSubmission(submissionId);
                if (submission) {
                    // send message to the user
                    const channel = await submission.getSubmissionChannel();
                    if (channel) {
                        const embed = new EmbedBuilder()
                            .setTitle(`Comment Deleted`)
                            .setColor('#ff0000')
                            .setAuthor({
                                name: deletedComment.sender.displayName || deletedComment.sender.username || 'Unknown Author',
                                iconURL: deletedComment.sender.iconURL || undefined,
                            })
                            .setDescription(deletedComment.content)
                            .setTimestamp();
                        if (deletedComment.attachments.length > 0) {
                            embed.addFields({
                                name: 'Attachments',
                                value: truncateStringWithEllipsis(deletedComment.attachments.map(a => a.name).join(', '), 1024)
                            });
                        }
                        channel.send({
                            flags: [MessageFlags.SuppressNotifications],
                            embeds: [embed]
                        });
                    }
                }
            } catch (e: any) {
                console.error("Error updating submission:", e.message);
            }

            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }
        } catch (e) {
            console.error("Error handling post message:", e);
        }
        this.lock.release();
    }

    public async handlePostThreadDelete(thread: AnyThreadChannel) {
        const postId = thread.id;

        if (!this.git) {
            throw new Error("Git not initialized");
        }


        const submissionId = await this.getSubmissionIDByPostID(postId);
        if (!submissionId || this.shouldIgnoreUpdates(submissionId)) {
            return;
        }

        await this.lock.acquire();
        try {

            const found = await this.findEntryBySubmissionId(submissionId);
            if (!found) {
                this.lock.release();
                return;
            }

            const entryPath = found.entry.getFolderPath();

            // Remove all files inside the entry folder
            const files = [];
            const stack = [entryPath];
            while (stack.length > 0) {
                const currentPath = stack.pop();
                if (!currentPath) continue;
                const entries = await fs.readdir(currentPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name === '.DS_Store') {
                        // delete .DS_Store files
                        await fs.unlink(Path.join(currentPath, entry.name));
                        continue; // Skip .DS_Store files
                    }
                    const fullPath = Path.join(currentPath, entry.name);
                    if (entry.isDirectory()) {
                        stack.push(fullPath);
                    } else {
                        files.push(fullPath);
                    }
                }
            }
            await this.git.rm(files);
            // delete folder
            await fs.rm(entryPath, { recursive: true, force: true });

            found.channel.getData().entries.splice(found.entryIndex, 1);
            await found.channel.save();
            await this.git.add(found.channel.getDataPath());

            await this.deleteSubmissionIDForPostID(postId);
            // Commit the removal
            await this.git.commit(`Force deleted ${found.entry.getData().code} ${found.entry.getData().name} from channel ${found.channel.getData().name} (${found.channel.getData().code})`);

            // check submission
            try {
                const submission = await this.guildHolder.getSubmissionsManager().getSubmission(submissionId);
                if (submission) {
                    submission.getConfigManager().setConfig(SubmissionConfigs.POST, null);
                    submission.getConfigManager().setConfig(SubmissionConfigs.STATUS, SubmissionStatus.RETRACTED);
                    submission.getConfigManager().setConfig(SubmissionConfigs.RETRACTION_REASON, 'Thread deleted');

                    // send message to the user
                    const channel = await submission.getSubmissionChannel();
                    if (channel) {
                        channel.send({
                            content: `Notice: The published post has been forcibly retracted because the thread was deleted.`
                        });

                        await submission.save();
                        await submission.statusUpdated();
                    }
                }
                this.guildHolder.logRetraction(found.entry.getData(), 'Thread deleted').catch(e => {
                    console.error("Error logging retraction:", e);
                });
            } catch (e: any) {
                console.error("Error updating submission config:", e.message);
            }

            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }
        } catch (e) {
            console.error("Error handling post thread delete:", e);
        }
        this.lock.release();
    }

    public async handlePostThreadUpdate(_oldThread: AnyThreadChannel, thread: AnyThreadChannel) {
        if (!thread.parent || thread.parent.type !== ChannelType.GuildForum) {
            return; // No parent, nothing to do
        }
        if (!this.git) {
            throw new Error("Git not initialized");
        }

        const postId = thread.id;
        const submissionId = await this.getSubmissionIDByPostID(postId);
        if (!submissionId || this.shouldIgnoreUpdates(submissionId)) {
            return;
        }

        await this.lock.acquire();
        try {


            const found = await this.findEntryBySubmissionId(submissionId);
            if (!found) {
                return;
            }

            // get tags from the thread
            const availableTags = thread.parent.availableTags;
            const newTags = []
            for (const tag of thread.appliedTags) {
                const availableTag = availableTags.find(t => t.id === tag);
                if (availableTag) {
                    newTags.push(availableTag);
                }
            }

            const entryData = found.entry.getData();

            const addedTags = [];
            const removedTags = []
            const modifiedTags = [];

            for (const tag of newTags) {
                const existingTag = entryData.tags.find(t => t.id === tag.id);
                if (existingTag) {
                    if (existingTag.name !== tag.name) {
                        modifiedTags.push(tag);
                    }
                } else {
                    addedTags.push(tag);
                }
            }

            for (const tag of entryData.tags) {
                const existingTag = newTags.find(t => t.id === tag.id);
                if (!existingTag) {
                    removedTags.push(tag);
                }
            }

            if (addedTags.length === 0 && removedTags.length === 0 && modifiedTags.length === 0) {
                // No tags changed, nothing to do
                this.lock.release();
                return;
            }

            entryData.tags = newTags.map(tag => ({
                id: tag.id,
                name: tag.name
            }));

            await found.entry.save();
            await this.git.add(found.entry.getDataPath());
            await this.git.add(await this.updateEntryReadme(found.entry));
            // check submission
            try {
                const submission = await this.guildHolder.getSubmissionsManager().getSubmission(submissionId);
                if (submission) {
                    submission.getConfigManager().setConfig(SubmissionConfigs.TAGS, entryData.tags);

                    // send message to the user
                    const channel = await submission.getSubmissionChannel();
                    if (channel) {

                        let message = ``;
                        if (addedTags.length > 0) {
                            if (addedTags.length === 1) {
                                message += `Added tag **${addedTags[0].name}**`;
                            } else {
                                message += `Added tags **${addedTags.map(t => t.name).join(', ')}**`;
                            }
                        }

                        if (removedTags.length > 0) {
                            if (message.length > 0) {
                                message += `, `;
                            }
                            if (removedTags.length === 1) {
                                message += `Removed tag **${removedTags[0].name}**`;
                            } else {
                                message += `Removed tags **${removedTags.map(t => t.name).join(', ')}**`;
                            }
                        }

                        if (addedTags.length > 0 || removedTags.length > 0) {
                            await channel.send({
                                content: message + (removedTags.length > 0 ? ' from the post.' : ' to the post.'),
                            });
                            await submission.save();
                            await submission.statusUpdated();
                        }
                    }
                }
                // this.guildHolder.logUpdate(oldEntryData, entryData).catch(e => {
                //     console.error("Error logging tag change:", e);
                // });
            } catch (e: any) {
                console.error("Error updating submission config:", e.message);
            }

            await this.git.commit(`Updated tags for ${entryData.code} because thread was updated`);
            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }
        } catch (e) {
            console.error("Error handling post thread update:", e);
        }
        this.lock.release();
    }

    public async getEntriesByAuthor(author: Author, endorsers: boolean = false): Promise<ArchiveEntryData[]> {
        const entries: ArchiveEntryData[] = [];
        const channelRefs = this.getChannelReferences();
        for (const channelRef of channelRefs) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            for (const entryRef of archiveChannel.getData().entries) {
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);
                if (!entry) {
                    continue; // Skip if entry cannot be loaded
                }
                const entryData = entry.getData();
                const compareAuthors = endorsers ? entryData.endorsers : entryData.authors;
                if (compareAuthors.some(otherAuthor => {
                    if (author.type === AuthorType.Unknown) {
                        return otherAuthor.username === author.username;
                    } else {
                        return otherAuthor.id === author.id;
                    }
                })) {
                    entries.push(entryData);
                }
            }
        }
        return entries;
    }

    public async updateEntryAuthorsTask() {
        if (!this.git) {
            return;
        }


        await this.lock.acquire();

        // First, collect authors
        const authors: Author[] = [];

        const channelRefs = this.getChannelReferences().slice(); // Copy to avoid mutation during iteration
        for (const channelRef of channelRefs) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            const entries = archiveChannel.getData().entries.slice(); // Copy to avoid mutation during iteration
            for (const entryRef of entries) {
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);
                if (!entry) {
                    console.warn(`Entry ${entryRef.name} in channel ${archiveChannel.getData().name} could not be loaded, skipping.`);
                    continue; // Skip if entry cannot be loaded
                }
                const entryData = entry.getData();
                for (const author of entryData.authors) {
                    if (!authors.some(a => areAuthorsSame(a, author))) {
                        authors.push(author);
                    }
                }
                for (const endorser of entryData.endorsers) {
                    if (!authors.some(a => areAuthorsSame(a, endorser))) {
                        authors.push(endorser);
                    }
                }
            }
        }

        const reclassified = [];
        const chunkSize = 10;
        for (let i = 0; i < authors.length; i += chunkSize) {
            const chunk = authors.slice(i, i + chunkSize);
            const reclassifiedChunk = await reclassifyAuthors(this.guildHolder, chunk);
            reclassified.push(...reclassifiedChunk);
        }

        let modifiedCount = 0;
        for (const channelRef of channelRefs) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            const entries = archiveChannel.getData().entries.slice(); // Copy to avoid mutation during iteration
            for (const entryRef of entries) {
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);
                if (!entry) {
                    console.warn(`Entry ${entryRef.name} in channel ${archiveChannel.getData().name} could not be loaded, skipping.`);
                    continue; // Skip if entry cannot be loaded
                }
                try {
                    if (await this.updateEntryAuthors(entry, reclassified)) {
                        modifiedCount++;
                    }
                } catch (e: any) {
                    console.error(`Error updating authors for entry ${entryRef.name} in channel ${archiveChannel.getData().name}:`, e.message);
                }

            }
        }
        if (modifiedCount > 0) {
            try {
                await this.git.commit(`Updated authors for ${modifiedCount} entries`);
                try {
                    await this.push();
                } catch (e: any) {
                    console.error("Error pushing to remote:", e.message);
                }
            }
            catch (e: any) {
                console.error("Error committing updated authors:", e.message);
            }
        }
        this.lock.release();
    }

    async updateEntryAuthors(entry: ArchiveEntry, updatedAuthors: Author[]) {
        if (!this.git) {
            return false;
        }

        const entryData = deepClone(entry.getData());
        const newAuthors = entryData.authors.map(author => {
            const updatedAuthor = updatedAuthors.find(a => areAuthorsSame(a, author));
            return updatedAuthor || author;
        });

        const newEndorsers = entryData.endorsers.map(endorser => {
            const updatedAuthor = updatedAuthors.find(a => areAuthorsSame(a, endorser));
            return updatedAuthor || endorser;
        });

        // check if they have changed
        const authorsChanged = !areAuthorsListEqual(entryData.authors, newAuthors, true);
        const endorsersChanged = !areAuthorsListEqual(entryData.endorsers, newEndorsers, true);
        if (!authorsChanged && !endorsersChanged) {
            return false; // No changes, nothing to do
        }

        // Read entry again
        await entry.load();

        // Check if the entry is still valid
        const newData = entry.getData();
        const authorsValid = areAuthorsListEqual(entryData.authors, newData.authors, true);
        const endorsersValid = areAuthorsListEqual(entryData.endorsers, newData.endorsers, true);
        if (!authorsValid || !endorsersValid) {
            console.warn(`Entry ${entryData.code} has been modified by another process, skipping author update.`);
            this.lock.release();
            return false; // Entry has been modified, skip this update
        }

        // Update authors and endorsers
        newData.authors.forEach(author => {
            if (author.type === AuthorType.Unknown) {
                return;
            }

            const updatedAuthor = updatedAuthors.find(a => areAuthorsSame(a, author));
            if (!updatedAuthor) {
                console.warn(`Author ${author.username} (${author.id}) not found in updated authors, skipping.`);
            } else {
                author.displayName = updatedAuthor.displayName;
                author.iconURL = updatedAuthor.iconURL;
                author.type = updatedAuthor.type;
                author.username = updatedAuthor.username;
            }
        });

        newData.endorsers.forEach(author => {
            if (author.type === AuthorType.Unknown) {
                return;
            }

            const updatedAuthor = updatedAuthors.find(a => areAuthorsSame(a, author));
            if (!updatedAuthor) {
                console.warn(`Endorser ${author.username} (${author.id}) not found in updated authors, skipping.`);
            } else {
                author.displayName = updatedAuthor.displayName;
                author.iconURL = updatedAuthor.iconURL;
                author.type = updatedAuthor.type;
                author.username = updatedAuthor.username;
            }
        });

        await entry.save();

        if (newData.post && newData.post.forumId) {
            await this.addOrUpdateEntryFromData(this.guildHolder, newData, newData.post.forumId, false, false, async () => { });
        }

        return true;
    }

    async updateEntryReadme(entry: ArchiveEntry): Promise<string> {
        const entryData = entry.getData();
        const readmePath = Path.join(entry.getFolderPath(), 'README.md');

        // Generate the README content
        let comments: ArchiveComment[] = [];
        const commentsFile = Path.join(entry.getFolderPath(), 'comments.json');
        try {
            comments = JSON.parse(await fs.readFile(commentsFile, 'utf-8')) as
                ArchiveComment[];
        } catch (e: any) {
            if (e.code !== 'ENOENT') {
                console.error("Error reading comments file:", e);
            }
        }
        const readmeContent = makeEntryReadMe(entryData, comments);

        // Write the README file
        await fs.writeFile(readmePath, readmeContent, 'utf-8');
        return readmePath
    }

    public async getArchiveStats(): Promise<{ numPosts: number, numSubmissions: number }> {
        let numPosts = 0;

        const channelRefs = this.getChannelReferences();
        for (const channelRef of channelRefs) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            numPosts += archiveChannel.getData().entries.length;
        }

        const numSubmissions = (await this.guildHolder.getSubmissionsManager().getSubmissionsList()).length;

        return {
            numPosts,
            numSubmissions
        };
    }

    public async getUserArchiveStats(user: Author): Promise<{ numPosts: number, numSubmissions: number, numEndorsed: number }> {
        let numPosts = 0;
        let numEndorsed = 0;

        const channelRefs = this.getChannelReferences();
        for (const channelRef of channelRefs) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            for (const entryRef of archiveChannel.getData().entries) {
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);
                if (!entry) {
                    continue; // Skip if entry cannot be loaded
                }
                const entryData = entry.getData();
                if (entryData.authors.some(a => areAuthorsSame(a, user))) {
                    numPosts++;
                }
                if (entryData.endorsers.some(a => areAuthorsSame(a, user))) {
                    numEndorsed++;
                }
            }
        }

        let numSubmissions = 0;
        const submissions = await this.guildHolder.getSubmissionsManager().getSubmissionsList();
        for (const submissionId of submissions) {
            const submission = await this.guildHolder.getSubmissionsManager().getSubmission(submissionId);
            if (!submission) {
                continue; // Skip if submission cannot be loaded
            }
            const authors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || [];
            if (authors.some(a => areAuthorsSame(a, user))) {
                numSubmissions++;
            }
        }
        return {
            numPosts,
            numSubmissions,
            numEndorsed
        };
    }

    public async republishAllEntries(doChannel: ForumChannel | null, replace: boolean, silent: boolean, interaction: ChatInputCommandInteraction): Promise<void> {

        if (!this.git) {
            throw new Error("Git not initialized");
        }

        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Interaction channel is not a text channel");
        }

        await this.lock.acquire();
        try {
            const channelRefs = this.getChannelReferences();
            for (const channelRef of channelRefs) {
                const channelPath = Path.join(this.folderPath, channelRef.path);
                const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
                if (doChannel && archiveChannel.getData().id !== doChannel.id) {
                    continue;
                }
                for (const entryRef of archiveChannel.getData().entries) {
                    const entryPath = Path.join(channelPath, entryRef.path);
                    const entry = await ArchiveEntry.fromFolder(entryPath);

                    if (!entry) {
                        await channel.send({ content: `Entry ${entryRef.name} (${entryRef.code}) could not be loaded, skipping.` });
                        continue; // Skip if entry cannot be loaded
                    }
                    const entryData = entry.getData();

                    const submission = await this.guildHolder.getSubmissionsManager().getSubmission(entryData.id);
                    // Get channel
                    const submissionChannel = submission ? await submission.getSubmissionChannel(true) : null;
                    const wasArchived = submissionChannel && submissionChannel.archived;
                    if (wasArchived) {
                        await submissionChannel.setArchived(false);
                    }


                    let result;
                    if (!entryData.post) {
                        await channel.send({ content: `Entry ${entryData.code} does not have a post, skipping.` });
                    } else {
                        try {
                            result = await this.addOrUpdateEntryFromData(this.guildHolder, entryData, entryData.post.forumId, replace, true, async () => { });
                            await channel.send({ content: `Entry ${entryData.code} republished: ${result.newEntryData.post?.threadURL}` });
                        } catch (e: any) {
                            console.error(e);
                            await channel.send({ content: `Error republishing entry ${entryData.code}: ${e.message}` });
                        }
                    }

                    // Get submission
                    if (!submission || !submissionChannel) {
                        await channel.send({ content: `Submission for entry ${entryData.code} not found, skipping.` });
                        continue;
                    }

                    submission.getConfigManager().setConfig(SubmissionConfigs.POST, result?.newEntryData.post || null);

                    try {
                        await submission.statusUpdated();
                        if (!silent) {
                            await submissionChannel.send(`Republished by bulk republish command, the post is now at ${result?.newEntryData?.post?.threadURL}`);
                        }
                    } catch (e: any) {
                        await channel.send({ content: `Error updating submission ${entryData.code} status: ${e.message}` });
                    }

                    if (wasArchived) {
                        await submissionChannel.setArchived(true);
                    }
                }
            }

            // Commit changes
            await this.git.commit(`Republished all entries${doChannel ? ` in channel ${doChannel.name}` : ''}`);

            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }

            this.lock.release();
        } catch (e) {
            this.lock.release();
            throw e;
        }

    }

    public async checkEveryPost(interaction: ChatInputCommandInteraction): Promise<void> {
        if (!this.git) {
            throw new Error("Git not initialized");
        }

        const channel = interaction.channel;
        if (!channel || channel.type !== ChannelType.GuildText) {
            throw new Error("Interaction channel is not a text channel");
        }

        await this.lock.acquire();
        try {
            const channelRefs = this.getChannelReferences();
            for (const channelRef of channelRefs) {
                const channelPath = Path.join(this.folderPath, channelRef.path);
                const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
                for (const entryRef of archiveChannel.getData().entries) {
                    const entryPath = Path.join(channelPath, entryRef.path);
                    const entry = await ArchiveEntry.fromFolder(entryPath);

                    if (!entry) {
                        await channel.send({ content: `Entry ${entryRef.name} (${entryRef.code}) could not be loaded, skipping.` });
                        continue; // Skip if entry cannot be loaded
                    }

                    const entryData = entry.getData();

                    if (!entryData.post) {
                        await channel.send({ content: `Entry ${entryData.code} does not have a post, skipping.` });
                        continue;
                    }

                    try {
                        const submission = await this.guildHolder.getSubmissionsManager().getSubmission(entryData.id);
                        if (!submission) {
                            await channel.send({ content: `Submission for entry ${entryData.code} not found, skipping.` });
                            continue;
                        }

                        // Check if authors are the same
                        const submissionAuthors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || [];
                        const entryAuthors = entryData.authors;
                        const equal = areAuthorsListEqual(submissionAuthors, entryAuthors, false, true);
                        if (!equal) {
                            await channel.send({ content: `Authors for entry ${entryData.post.threadURL} does not match submission!` });
                        }
                    } catch (e: any) {
                        console.error(e);
                        await channel.send({ content: `Error checking post for entry ${entryData.code}: ${e.message}` });
                    }
                }
            }

            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }

            this.lock.release();
        } catch (e) {
            this.lock.release();
            throw e;
        }

    }
}
