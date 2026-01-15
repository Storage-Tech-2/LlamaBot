import { GuildHolder } from "../GuildHolder.js";
import fs from "fs/promises";
import { ConfigManager } from "../config/ConfigManager.js";
import Path from "path";
import { AnyThreadChannel, AttachmentBuilder, ChannelType, EmbedBuilder, ForumChannel, ForumLayoutType, GuildTextBasedChannel, Message, MessageFlags, PartialMessage, Snowflake } from "discord.js";
import { ArchiveChannelReference, RepositoryConfigs } from "./RepositoryConfigs.js";
import { areAuthorsSame, chunkArray, deepClone, escapeString, generateCommitMessage, getAuthorIconURL, getAuthorName, getChangeIDs, getCodeAndDescriptionFromTopic, getGithubOwnerAndProject, mergeTwoArraysUnique, reclassifyAuthors, splitCode, splitIntoChunks, truncateStringWithEllipsis } from "../utils/Util.js";
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
import { analyzeAttachments, filterAttachmentsForViewer, getAttachmentsFromMessage, getAttachmentsFromText, getFileKey, processAttachments } from "../utils/AttachmentUtils.js";
import { DictionaryManager } from "./DictionaryManager.js";
import { IndexManager } from "./IndexManager.js";
import { DiscordServersDictionary } from "./DiscordServersDictionary.js";
import { getDiscordServersFromReferences, ReferenceType, tagReferencesInAcknowledgements, tagReferencesInSubmissionRecords, transformOutputWithReferencesForEmbeddings, transformOutputWithReferencesForGithub } from "../utils/ReferenceUtils.js";
import { PersistentIndex, PersistentIndexChannel, PersistentIndexEntry, serializePersistentIndex } from "../utils/PersistentIndexUtils.js";
import { postToMarkdown } from "../utils/MarkdownUtils.js";
import { generateDocumentEmbeddings } from "../llm/EmbeddingUtils.js";

export type EmbeddingsEntry = {
    code: string;
    updated_at: number;
    embedding: string; // base64 encoded string
}

export class RepositoryManager {
    public folderPath: string;
    private git?: SimpleGit;
    private configManager: ConfigManager;
    private lock: Lock = new Lock();
    private ignoreUpdatesFrom: Snowflake[] = [];
    private guildHolder: GuildHolder;
    private dictionaryManager: DictionaryManager;
    private indexManager: IndexManager;
    private discordServersDictionary: DiscordServersDictionary;
    constructor(guildHolder: GuildHolder, folderPath: string, globalDiscordServersDictionary?: DiscordServersDictionary) {
        this.guildHolder = guildHolder;
        this.folderPath = folderPath;
        this.configManager = new ConfigManager(Path.join(folderPath, 'config.json'));
        this.dictionaryManager = new DictionaryManager(this.guildHolder, Path.join(this.folderPath, 'dictionary'), this);
        this.indexManager = new IndexManager(this.dictionaryManager, this, this.folderPath);
        this.dictionaryManager.setIndexManager(this.indexManager);
        this.discordServersDictionary = new DiscordServersDictionary(this.folderPath, this, globalDiscordServersDictionary);

        this.configManager.setChangeListener(async () => {
            // if (this.git) {
            //     await this.commit('Updated repository configuration', [Path.join(this.folderPath, 'config.json')]).catch(() => { });
            //     await this.push().catch(() => { });
            // }
        });
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
            await this.commit('Initial commit: add .gitignore');
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

        await this.indexManager.getPostToSubmissionIndex();
        await this.dictionaryManager.init();
    }

    public async add(paths: string | string[]) {
        if (!this.git) {
            return;
        }
        await this.git.add(paths).catch(() => { });
    }

    public async rm(paths: string | string[]) {
        if (!this.git) {
            return;
        }
        await this.git.rm(paths).catch(() => { });
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

    public async getEmbeddings(): Promise<EmbeddingsEntry[]> {
        const embeddingPath = this.getEmbeddingPath();
        return fs.readFile(embeddingPath, 'utf-8')
            .then(data => JSON.parse(data) as EmbeddingsEntry[])
            .catch(() => []);
    }

    public async buildPersistentIndexAndEmbeddings() {
        const authors = new Map<string, number>();
        const tags = new Map<string, number>();
        const categories = new Map<string, number>();

        const channelReferences = this.getChannelReferences();

        channelReferences.sort((a, b) => a.position - b.position);

        const channels: PersistentIndexChannel[] = [];

        const embeddings = await this.getEmbeddings();
        const embeddingsMap = new Map<string, EmbeddingsEntry>(embeddings.map(e => [e.code, e]));
        const seenCodes = new Set<string>();
        const toRefreshEmbeddings = new Set<string>();

        for (const channelRef of channelReferences) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            const entryRefs = archiveChannel.getData().entries;


            const entries: PersistentIndexEntry[] = [];

            const channelTags = new Set<number>();

            for (const entryRef of entryRefs) {
                const entryPath = Path.join(channelPath, entryRef.path);
                const archiveEntry = await ArchiveEntry.fromFolder(entryPath);
                if (!archiveEntry) {
                    continue;
                }
                const entryData = archiveEntry.getData();

                // map authors
                const authorIndexes = entryData.authors.map(author => {
                    const name = getAuthorName(author);
                    if (!authors.has(name)) {
                        authors.set(name, authors.size);
                    }
                    return authors.get(name)!;
                });

                // map tags
                const tagIndexes = entryData.tags.map(tag => {
                    if (!tags.has(tag.name)) {
                        tags.set(tag.name, tags.size);
                    }
                    const tagIndex = tags.get(tag.name)!;
                    channelTags.add(tagIndex);
                    return tagIndex;
                });


                const currentCode = entryData.code;
                const pastCodes = entryData.reservedCodes.filter(code => code !== currentCode);
                entries.push({
                    id: entryData.id,
                    codes: [currentCode, ...pastCodes],
                    name: entryData.name,
                    authors: authorIndexes,
                    tags: tagIndexes,
                    path: entryRef.path,
                    archived_at: entryData.archivedAt,
                    updated_at: entryData.updatedAt,
                    main_image_path: entryData.images.length > 0 ? entryData.images[0].path || null : null
                });

                seenCodes.add(currentCode);

                const embeddingEntry = embeddingsMap.get(currentCode);
                if (!embeddingEntry || embeddingEntry.updated_at !== entryData.updatedAt) {
                    toRefreshEmbeddings.add(entryPath);
                }
            }

            // map categories
            if (!categories.has(channelRef.category)) {
                categories.set(channelRef.category, categories.size);
            }
            const categoryIndex = categories.get(channelRef.category)!;

            channels.push({
                code: channelRef.code,
                name: channelRef.name,
                description: channelRef.description,
                category: categoryIndex,
                tags: Array.from(channelTags),
                path: channelRef.path,
                entries: entries
            })
        }

        const persistentIndex: PersistentIndex = {
            schemaStyles: this.configManager.getConfig(RepositoryConfigs.POST_STYLE),
            updated_at: Date.now(),
            all_authors: Array.from(authors.keys()),
            all_tags: Array.from(tags.keys()),
            all_categories: Array.from(categories.keys()),
            channels: channels
        };

        const serialized = serializePersistentIndex(persistentIndex);

        const indexPath = this.getPersistentIndexPath();
        await fs.writeFile(indexPath, Buffer.from(serialized));

        await this.git?.add(indexPath);

        // now handle embeddings refresh
        const embeddingsToDelete: string[] = [];
        for (const embeddingEntry of embeddings) {
            if (!seenCodes.has(embeddingEntry.code)) {
                embeddingsToDelete.push(embeddingEntry.code);
            }
        }

        for (const code of embeddingsToDelete) {
            embeddingsMap.delete(code);
        }

        const toRefreshEmbeddingsChunked = chunkArray(Array.from(toRefreshEmbeddings), 20);
        for (const chunk of toRefreshEmbeddingsChunked) {
            const entries = (await Promise.all(chunk.map(async entryPath => {
                const archiveEntry = await ArchiveEntry.fromFolder(entryPath);
                if (!archiveEntry) {
                    return null;
                }
                const entryData = archiveEntry.getData();
                return entryData;
            }))).filter((e): e is ArchiveEntryData => e !== null);


            // get text
            const texts = entries.map(entryData => {
                return entryData.name + '\n' + transformOutputWithReferencesForEmbeddings(postToMarkdown(entryData.records, entryData.styles, persistentIndex.schemaStyles), entryData.references);
            });

            const result = await generateDocumentEmbeddings(texts).catch((e) => {
                console.error("Error generating document embeddings for archive entries:", e);
                return null;
            });

            if (result === null) {
                continue;
            }

            for (let i = 0; i < entries.length; i++) {
                const entryData = entries[i];
                const embedding = result.embeddings[i];
                embeddingsMap.set(entryData.code, {
                    code: entryData.code,
                    updated_at: entryData.updatedAt,
                    embedding: embedding
                });
            }
        }

        if (toRefreshEmbeddings.size > 0 || embeddingsToDelete.length > 0) {
            const newEmbeddings = Array.from(embeddingsMap.values());
            await fs.writeFile(this.getEmbeddingPath(), JSON.stringify(newEmbeddings, null, 2), 'utf-8');
            await this.git?.add(this.getEmbeddingPath());
        }
    }


    public getPersistentIndexPath(): string {
        return Path.join(this.folderPath, 'persistent.idx');
    }

    public getEmbeddingPath(): string {
        return Path.join(this.folderPath, 'embeddings.json');
    }

    public async iterateAllEntries(callback: (entry: ArchiveEntry, entryRef: ArchiveEntryReference, channelRef: ArchiveChannelReference, channel: ArchiveChannel) => Promise<void>) {
        const channelReferences = this.getChannelReferences();
        for (const channelRef of channelReferences) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            if (!archiveChannel) {
                console.warn(`Channel ${channelRef.name} (${channelRef.id}) not found in repository`);
                continue;
            }
            const entries = archiveChannel.getData().entries;
            for (const entryRef of entries) {
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);
                if (!entry) {
                    console.warn(`Entry ${entryRef.code} not found in repository`);
                    continue;
                }
                await callback(entry, entryRef, channelRef, archiveChannel);
            }
        }
    }

    public async iterateAllEntryRefs(callback: (entryRef: ArchiveEntryReference, channelRef: ArchiveChannelReference, channel: ArchiveChannel) => Promise<void>) {
        const channelReferences = this.getChannelReferences();
        for (const channelRef of channelReferences) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            if (!archiveChannel) {
                console.warn(`Channel ${channelRef.name} (${channelRef.id}) not found in repository`);
                continue;
            }
            const entries = archiveChannel.getData().entries;
            for (const entryRef of entries) {
                await callback(entryRef, channelRef, archiveChannel);
            }
        }
    }

    shouldIgnoreUpdates(id: Snowflake): boolean {
        return this.ignoreUpdatesFrom.includes(id);
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

        this.dictionaryManager.invalidateArchiveIndex();

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
                description: description || 'No description',
                position: channel.rawPosition
            });
        }

        // sort by position
        reMapped.sort((a, b) => a.position - b.position);


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
            await this.git.rm(['-r', channelPath]);
            await this.commit(`Removed channel ${channel.name} (${channel.code})`);
        }

        // Then, add new channels
        for (const channel of newChannels) {
            const channelPath = Path.join(this.folderPath, channel.path);

            await fs.mkdir(channelPath, { recursive: true });

            // make new channel
            const newChannel = ArchiveChannel.newFromReference(channel, channelPath);
            await newChannel.savePrivate();


            // Commit the new channel
            await this.git.add(channelPath);
            await this.commit(`Added channel ${channel.name} (${channel.code})`);
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
                throw new Error(`Channel ${channel.name} (${channel.id}) not found in repository`);
            }

            const entries = channelInstance.getData().entries;
            const newEntries: ArchiveEntryReference[] = [];
            for (const oldEntryRef of entries) {
                // Check if the file is a directory
                const newEntryRef: ArchiveEntryReference = {
                    ...oldEntryRef
                };

                // get name and code
                const oldEntry = await ArchiveEntry.fromFolder(Path.join(newPath, oldEntryRef.path));
                if (!oldEntry) {
                    throw new Error(`Old entry ${oldEntryRef.code} not found in repository`);
                }

                newEntryRef.code = channel.code + oldEntryRef.code.replace(new RegExp(`^${oldChannel.code}`), '');
                newEntryRef.path = `${newEntryRef.code}_${escapeString(oldEntry.getData().name || '')}`;

                const oldFolderPath = Path.join(newPath, oldEntryRef.path);
                const newFolderPath = Path.join(newPath, newEntryRef.path);
                // Rename
                if (oldFolderPath !== newFolderPath) {
                    await this.git.mv(oldFolderPath, newFolderPath);
                }

                // Load entry
                const entry = await ArchiveEntry.fromFolder(newFolderPath);
                if (!entry) {
                    throw new Error(`Entry ${oldEntryRef.code} not found in repository`);
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
                await entry.savePrivate();
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
            await channelInstance.savePrivate();

            if (oldPath !== newPath) {
                // republish everything
                for (const entryRef of newEntries) {
                    const entryPath = Path.join(newPath, entryRef.path);
                    const entry = await ArchiveEntry.fromFolder(entryPath);
                    if (!entry) {
                        throw new Error(`Entry ${entryRef.code} not found in repository`);
                    }
                    // republish the entry
                    await this.addOrUpdateEntryFromData(entry.getData(), channel.id, false, false, async () => { });
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
            await this.commit(msg);
        }

        // Check tags for entries
        for (const channel of reMapped) {
            const channelPath = Path.join(this.folderPath, channel.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            if (!archiveChannel) {
                console.warn(`Channel ${channel.name} (${channel.id}) not found in repository`);
                continue;
            }
            const entries = archiveChannel.getData().entries;
            let changed = false;
            for (const entryRef of entries) {
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);
                if (!entry) {
                    console.warn(`Entry ${entryRef.code} not found in repository`);
                    continue;
                }
            }
            if (changed) {
                await archiveChannel.savePrivate();
                await this.git.add(archiveChannel.getDataPath());
            }
        }

        // Finally, save the new config
        this.configManager.setConfig(RepositoryConfigs.ARCHIVE_CHANNELS, reMapped);
        await this.save();

        // Rebuild index
        await this.buildPersistentIndexAndEmbeddings();

        // Add config if it doesn't exist
        await this.git.add(Path.join(this.folderPath, 'config.json'));
        await this.commit('Updated repository configuration');
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

    async getEntryByPostCode(submissionCode: string): Promise<null | {
        channelRef: ArchiveChannelReference,
        channel: ArchiveChannel,
        entry: ArchiveEntry,
        entryRef: ArchiveEntryReference,
        entryIndex: number
    }> {
        submissionCode = submissionCode.toUpperCase();

        const {
            channelCode,
        } = splitCode(submissionCode);

        const channelReferences = this.getChannelReferences();
        const channelRef = channelReferences.find(c => c.code === channelCode);
        if (!channelRef) {
            return null;
        }

        const channelPath = Path.join(this.folderPath, channelRef.path);
        const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
        const entries = archiveChannel.getData().entries;
        const entryIndex = entries.findIndex(e => e.code === submissionCode);
        if (entryIndex !== -1) {
            const entryRef = entries[entryIndex];
            const entryPath = Path.join(channelPath, entryRef.path);
            const entry = await ArchiveEntry.fromFolder(entryPath);
            if (!entry) {
                return null; // Skip if entry could not be loaded
            }
            return {
                channelRef,
                channel: archiveChannel,
                entry,
                entryRef,
                entryIndex
            };
        }
        return null;
    }

    async addOrUpdateEntryFromSubmission(
        submission: Submission,
        forceNew: boolean,
        statusCallback?: (status: string) => Promise<void>
    ): Promise<{ oldEntryData?: ArchiveEntryData, newEntryData: ArchiveEntryData }> {

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

            await archiveChannel.savePrivate();

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

            const pastPostThreadIds = config.getConfig(SubmissionConfigs.PAST_POST_THREAD_IDS);
            const oldRef = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS_REFERENCES);
            const authors = await reclassifyAuthors(this.guildHolder, config.getConfig(SubmissionConfigs.AUTHORS) || []);
            const now = Date.now();
            entryData = deepClone({
                id: submission.getId(),
                name: config.getConfig(SubmissionConfigs.NAME),
                code: newCode,

                reservedCodes: reservedCodes,
                pastPostThreadIds: pastPostThreadIds,

                authors: authors,
                endorsers: await reclassifyAuthors(this.guildHolder, config.getConfig(SubmissionConfigs.ENDORSERS)),
                tags: config.getConfig(SubmissionConfigs.TAGS) || [],
                images: submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) || [],
                attachments: submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) || [],
                records: revision.records,
                styles: revision.styles,
                references: await tagReferencesInSubmissionRecords(revision.records, revision.references, this.guildHolder, submission.getId()),
                author_references: await tagReferencesInAcknowledgements(authors, oldRef, this.guildHolder, submission.getId()),
                updatedAt: now,
                archivedAt: now,
                post: undefined
            });

            for (const ref of revision.references) {
                if (ref.type === ReferenceType.DICTIONARY_TERM) {
                    const item = await this.dictionaryManager.getEntry(ref.id);
                    if (!item) continue;
                    if (!item.referencedBy.some(r => r === entryData?.code)) {
                        item.referencedBy.push(entryData.code);
                        await this.dictionaryManager.saveEntry(item).catch(() => { });
                        await this.dictionaryManager.updateStatusMessage(item).catch(() => { });
                    }
                }
            }

            if (!submissionChannel || !entryData) {
                throw new Error("Failed to get submission channel or entry data");
            }
            const result = await this.addOrUpdateEntryFromData(entryData, archiveChannelId, forceNew, false, async (entryData, imageFolder, attachmentFolder) => {
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

            }, statusCallback);

            const newEntryData = result.newEntryData;
            const oldEntryData = result.oldEntryData;

            await this.buildPersistentIndexAndEmbeddings();

            if (oldEntryData) {
                await this.commit(`${newEntryData.code}: ${generateCommitMessage(oldEntryData, newEntryData)}`);
            } else {
                await this.commit(`Added entry ${newEntryData.name} (${newEntryData.code}) to channel ${archiveChannel.getData().name} (${archiveChannel.getData().code})`);
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


    async addOrUpdateEntryFromData(
        newEntryData: ArchiveEntryData,
        archiveChannelId: Snowflake,
        forceNew: boolean,
        reanalyzeAttachments: boolean,
        moveAttachments: (entryData: ArchiveEntryData, imageFolder: string, attachmentFolder: string) => Promise<void>,
        statusCallback: (status: string) => Promise<void> | void = () => { }
    ): Promise<{ oldEntryData?: ArchiveEntryData, newEntryData: ArchiveEntryData }> {
        const guildHolder = this.guildHolder;
        // clone entryData
        newEntryData = deepClone(newEntryData);

        if (!this.git) {
            throw new Error("Git not initialized");
        }

        const reportStatus = async (status: string) => {
            try {
                await statusCallback(status);
            } catch (e) {
                console.error("Status callback failed:", e);
            }
        };

        this.addToIgnoreUpdatesFrom(newEntryData.id);

        if (!archiveChannelId) {
            throw new Error("Submission does not have an archive channel set");
        }


        const archiveChannelRef = this.getChannelReferences().find(c => c.id === archiveChannelId);
        if (!archiveChannelRef) {
            throw new Error("Archive channel reference not found");
        }

        await reportStatus('Collecting information...');

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

        const existing = await this.findEntryBySubmissionId(newEntryData.id);
        const isSameChannel = existing && existing.channelRef.id === archiveChannelId;

        const entryRef: ArchiveEntryReference = {
            id: newEntryData.id,
            code: newEntryData.code,
            path: `${newEntryData.code}_${escapeString(newEntryData.name) || ''}`,
        }

        if (existing) {
            newEntryData.archivedAt = existing.entry.getData().archivedAt;
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
                await existing.channel.savePrivate();
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
            await reportStatus('Reanalyzing attachments');
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
            await reportStatus('Uploading attachments...');

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
        const messageChunks: {
            content: string;
            showEmbed: boolean;
            embeds: EmbedBuilder[];
        }[] = splitIntoChunks(message, 2000).map((m) => {
            return {
                content: m,
                showEmbed: false,
                embeds: []
            }
        });

        const serverLinks = getDiscordServersFromReferences([newEntryData.references, newEntryData.author_references].flat());
        if (serverLinks.length > 0) {
            const serverLinkMessage: string[] = [];
            serverLinks.forEach((link) => {
                serverLinkMessage.push(`**${link.name}**: ${link.joinURL}`);
            });
            const serverLinkMsg = truncateStringWithEllipsis(serverLinkMessage.join('\n'), 4000);
            messageChunks.push({
                content: '',
                showEmbed: true,
                embeds: [
                    new EmbedBuilder().setTitle('Server Invite Links').setDescription(serverLinkMsg).setColor(0x00AE86)
                ]
            });
        }

        const hasAttachments = newEntryData.attachments.length > 0;
        if (hasAttachments) {
            const attachmentMessageChunks = splitIntoChunks(await PostEmbed.createAttachmentMessage(this.guildHolder, newEntryData, branchName, entryPathPart, uploadMessage), 2000);
            attachmentMessageChunks.forEach(c => {
                messageChunks.push({
                    content: c,
                    showEmbed: false,
                    embeds: []
                })
            })

            const filtered = filterAttachmentsForViewer(newEntryData.attachments);
            if (filtered.length > 0) {
                const viewerChunks = splitIntoChunks(PostEmbed.createAttachmentViewerMessage(filtered, uploadMessage), 2000);
                viewerChunks.forEach(c => {
                    messageChunks.push({
                        content: c,
                        showEmbed: true,
                        embeds: []
                    })
                })
            }
        }

        let wasThreadCreated = false;
        if (!thread) {

            await reportStatus('Creating thread...');
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

        newEntryData.pastPostThreadIds = mergeTwoArraysUnique(existing ? existing.entry.getData().pastPostThreadIds : [], newEntryData.pastPostThreadIds);

        if (!newEntryData.pastPostThreadIds.includes(thread.id)) {
            newEntryData.pastPostThreadIds.push(thread.id);
        }

        newEntryData.reservedCodes = mergeTwoArraysUnique(existing ? existing.entry.getData().reservedCodes : [], newEntryData.reservedCodes);

        if (!newEntryData.reservedCodes.includes(newEntryData.code)) {
            newEntryData.reservedCodes.push(newEntryData.code);
        }

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
        let continuingMessageIds = newEntryData.post.continuingMessageIds || [];
        const shouldRefreshThread = (messageChunks.length > 1 + continuingMessageIds.length) && comments && comments.length > 0;
        if (shouldRefreshThread) {
            await reportStatus('Clearing old thread messages...');
            // Delete all previous messages in the thread that are not part of the continuing messages
            for (let i = 0; i < 100; i++) {
                const messages = await thread.messages.fetch({ limit: 100 });
                let deletedCount = 0;
                for (const message of messages.values()) {
                    if (message.id !== initialMessage.id) {
                        await message.delete();
                        deletedCount++;
                    }
                }
                if (deletedCount === 0) {
                    break; // No more messages to delete
                }
            }
            continuingMessageIds = []; // Reset continuing message IDs to force re-creation
        }


        await reportStatus('Updating thread contents...');

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
                flags: [MessageFlags.SuppressEmbeds, MessageFlags.SuppressNotifications],
            });
            continuingMessageIds.push(message.id);
        }

        // Update the initial message with the first chunk
        if (messageChunks.length > 0) {
            await initialMessage.edit({
                content: messageChunks[0].content,
                flags: messageChunks[0].showEmbed ? [] : [MessageFlags.SuppressEmbeds],
                embeds: messageChunks[0].embeds,
                allowedMentions: { parse: [] }
            });
        }

        // If there are more chunks, send them as separate messages
        for (let i = 1; i < messageChunks.length; i++) {
            const messageId = continuingMessageIds[i - 1];
            const message = await thread.messages.fetch(messageId).catch(() => null);
            if (!message) {
                throw new Error(`Message with ID ${messageId} not found in thread ${thread.id}`);
            }
            await message.edit({
                content: messageChunks[i].content,
                flags: messageChunks[i].showEmbed ? [] : [MessageFlags.SuppressEmbeds],
                embeds: messageChunks[i].embeds,
                allowedMentions: { parse: [] }
            });
        }

        newEntryData.post.continuingMessageIds = continuingMessageIds;

        if (wasThreadCreated || shouldRefreshThread) { // check if there are comments to post
            if (comments.length > 0 && thread.parent) {
                // make webhook
                await reportStatus('Posting comments to thread');
                const threadWebhook = await thread.parent.createWebhook({
                    name: 'LlamaBot Archiver'
                });



                for (const comment of comments) {
                    const author = (await reclassifyAuthors(this.guildHolder, [comment.sender]))[0];
                    comment.sender = author;

                    const textAttachments = getAttachmentsFromText(comment.content);

                    const files: AttachmentBuilder[] = [];
                    if (comment.attachments.length > 0) {
                        for (const attachment of comment.attachments) {
                            if (!attachment.canDownload || !attachment.path || attachment.contentType === 'discord') {
                                continue; // Skip attachments that cannot be downloaded or have no path
                            }

                            // check if the attachment exists in textAttachments
                            if (textAttachments.some(a => a.id === attachment.id)) {
                                continue; // Skip attachments that are already in the text
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
                        username: getAuthorName(author) || 'Unknown Author',
                        avatarURL: getAuthorIconURL(author),
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

        await reportStatus('Saving data in repository...');
        await entry.savePrivate();
        await archiveChannel.savePrivate();
        await this.git.add(archiveChannel.getDataPath());

        await this.git.add(await this.updateEntryReadme(entry));

        await this.git.add(entryFolderPath);
        await this.git.add(channelPath); // to update currentCodeId and entries

        await this.indexManager.setSubmissionIDForPostID(thread.id, newEntryData.id);
        this.removeFromIgnoreUpdatesFrom(newEntryData.id);


        if (existing) {
            const oldPath = existing.channelRef.path + '/' + existing.entryRef.path;
            const newPath = archiveChannelRef.path + '/' + entryRef.path;
            const oldEntryData = existing.entry.getData();

            const needsRefreshReferences = oldEntryData.post?.threadURL !== newEntryData.post?.threadURL || oldPath !== newPath;
            if (needsRefreshReferences) {
                await reportStatus('Updating cross-references in archive...');

                this.getDictionaryManager().invalidateArchiveIndex();

                const newURL = newEntryData.post?.threadURL || '';
                // just swap urls, no need to reanalyze
                await this.iterateAllEntries(async (entry: ArchiveEntry) => {
                    if (entry.getData().id === newEntryData.id) {
                        return;
                    }

                    // check references
                    const otherData = entry.getData();
                    const references = otherData.references;
                    const authorReferences = otherData.author_references;

                    // check if any are post
                    let updated = false;
                    for (const reference of references) {
                        if (reference.type === ReferenceType.ARCHIVED_POST && reference.id === newEntryData.id) {
                            reference.url = newURL;
                            reference.path = newPath;
                            updated = true;
                        }
                    }

                    for (const authorReference of authorReferences) {
                        if (authorReference.type === ReferenceType.ARCHIVED_POST && authorReference.id === newEntryData.id) {
                            authorReference.url = newURL;
                            authorReference.path = newPath;
                            updated = true;
                        }
                    }

                    if (updated && otherData.post) {
                        await this.addOrUpdateEntryFromData(otherData, otherData.post.forumId, false, false, async () => {
                            // do nothing
                        }).catch(e => {
                            console.error("Error updating entry for URL update:", e);
                        });
                    }
                }).catch(e => {
                    console.error("Error iterating all entries:", e);
                });

                // update definitions
                await this.getDictionaryManager().iterateEntries(async (definition) => {
                    let updated = false;
                    for (const reference of definition.references) {
                        if (reference.type === ReferenceType.ARCHIVED_POST && reference.id === newEntryData.id) {
                            reference.url = newURL;
                            reference.path = newPath;
                            updated = true;
                        }
                    }
                    if (updated) {
                        await this.getDictionaryManager().saveEntry(definition);
                        await this.getDictionaryManager().updateStatusMessage(definition).catch(e => {
                            console.error("Error updating definition status message:", e);
                        });
                    }
                });
            }

            await reportStatus('Running post-update tasks...');

            this.guildHolder.onPostUpdate(oldEntryData, entry.getData()).catch(e => {
                console.error("Error handling post update:", e);
            });
        } else {
            await reportStatus('Running post-add tasks...');
            this.guildHolder.onPostAdd(entry.getData()).catch(e => {
                console.error("Error handling post add:", e);
            });
        }

        return {
            oldEntryData: existing ? existing.entry.getData() : undefined,
            newEntryData: entry.getData()
        }
    }

    public updateSubmissionFromEntryData(submission: Submission, entryData?: ArchiveEntryData, removed: boolean = false) {
        const submissionConfig = submission.getConfigManager();
        submissionConfig.setConfig(SubmissionConfigs.POST, removed ? null : (entryData?.post || null));
        const pastThreadsPost = entryData?.pastPostThreadIds || [];
        const pastThreadsSubmission = submissionConfig.getConfig(SubmissionConfigs.PAST_POST_THREAD_IDS);
        const merged = mergeTwoArraysUnique(pastThreadsSubmission, pastThreadsPost);
        submissionConfig.setConfig(SubmissionConfigs.PAST_POST_THREAD_IDS, merged);
        const pastReservedCodes = submissionConfig.getConfig(SubmissionConfigs.RESERVED_CODES);
        const reservedCodesFromEntry = entryData?.reservedCodes || [];
        const mergedCodes = mergeTwoArraysUnique(pastReservedCodes, reservedCodesFromEntry);
        submissionConfig.setConfig(SubmissionConfigs.RESERVED_CODES, mergedCodes);
    }

    async retractSubmission(submission: Submission, reason: string): Promise<ArchiveEntryData> {
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
            await foundChannel.savePrivate();
            await this.git.add(foundChannel.getDataPath());

            await this.buildPersistentIndexAndEmbeddings();

            // Commit the removal
            await this.commit(`Retracted entry ${entryData.name} (${entryData.code}) from channel ${foundChannel.getData().name} (${foundChannel.getData().code})\nReason: ${reason || 'No reason provided'}`);

            // Now post to discord
            await this.removeDiscordPost(entryData, submission, reason);

            // Remove post
            this.updateSubmissionFromEntryData(submission, entryData, true);

            await submission.save();
            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }

            await this.indexManager.deleteSubmissionIDForPostID(entryData.post?.threadId || '');
            this.removeFromIgnoreUpdatesFrom(submission.getId());

            this.guildHolder.onPostDelete(found.entry.getData()).catch(e => {
                console.error("Error handling post delete:", e);
            });

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


    public sanitizeGit(message: string): string {
        return message.replace(/"/g, '').replace(/'/g, '');
    }

    public async commit(message: string, files?: string | string[]) {
        if (!this.git) {
            return;
        }
        await this.git.commit(this.sanitizeGit(message), files);
    }

    public getLock(): Lock {
        return this.lock;
    }

    public async push() {
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


        const submissionId = await this.indexManager.getSubmissionIDByPostID(postId);
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
                    displayName: message.member?.displayName || message.author.username,
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
                await this.commit(`Updated comment by ${message.member?.displayName} on ${found.entry.getData().code}`);
            } else {
                await this.commit(`Added ${message.member?.displayName}'s comment to ${found.entry.getData().code}`);
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
                                name: getAuthorName(newComment.sender) || 'Unknown Author',
                                iconURL: getAuthorIconURL(newComment.sender),
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

    public async handlePostMessageDelete(message: Message | PartialMessage) {

        if (!this.git) {
            throw new Error("Git not initialized");
        }

        const postId = message.channelId;
        const submissionId = await this.indexManager.getSubmissionIDByPostID(postId);
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
            await this.commit(`Deleted ${getAuthorName(deletedComment.sender)}'s comment from ${found.entry.getData().code}`);

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
                                name: getAuthorName(deletedComment.sender) || 'Unknown Author',
                                iconURL: getAuthorIconURL(deletedComment.sender),
                            })
                            .setDescription(deletedComment.content || "(No content)")
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


        const submissionId = await this.indexManager.getSubmissionIDByPostID(postId);
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
            await found.channel.savePrivate();
            await this.git.add(found.channel.getDataPath());
            await this.indexManager.deleteSubmissionIDForPostID(postId);

            await this.buildPersistentIndexAndEmbeddings();

            // Commit the removal
            await this.commit(`Force deleted ${found.entry.getData().code} ${found.entry.getData().name} from channel ${found.channel.getData().name} (${found.channel.getData().code})`);

            // check submission
            try {
                const submission = await this.guildHolder.getSubmissionsManager().getSubmission(submissionId);
                if (submission) {
                    this.updateSubmissionFromEntryData(submission, found.entry.getData(), true);
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
                this.guildHolder.onPostDelete(found.entry.getData()).catch(e => {
                    console.error("Error handling post delete:", e);
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
        const submissionId = await this.indexManager.getSubmissionIDByPostID(postId);
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
            const oldData = deepClone(entryData);

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

            await found.channel.savePrivate();
            await this.git.add(found.channel.getDataPath());
            await found.entry.savePrivate();
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

                            await this.buildPersistentIndexAndEmbeddings();
                        }
                    }
                }
                // this.guildHolder.logUpdate(oldEntryData, entryData).catch(e => {
                //     console.error("Error logging tag change:", e);
                // });
            } catch (e: any) {
                console.error("Error updating submission config:", e.message);
            }

            await this.commit(`Updated tags for ${entryData.code} because thread was updated`);
            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }

            this.guildHolder.onPostUpdate(oldData, entryData).catch(e => {
                console.error("Error handling post update:", e);
            });
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
                    return areAuthorsSame(otherAuthor, author);
                })) {
                    entries.push(entryData);
                }
            }
        }
        return entries;
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
        const readmeContent = makeEntryReadMe(entryData, comments, this.guildHolder.getSchemaStyles());

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

    public getDictionaryManager(): DictionaryManager {
        return this.dictionaryManager;
    }

    public getIndexManager(): IndexManager {
        return this.indexManager;
    }

    public getDiscordServersDictionary(): DiscordServersDictionary {
        return this.discordServersDictionary;
    }

    public isReady(): boolean {
        return this.git !== null;
    }

    public getGuildHolder(): GuildHolder {
        return this.guildHolder;
    }
}
