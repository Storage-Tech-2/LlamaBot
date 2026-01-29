import fs from "fs/promises";
import Path from "path";
import { ChannelType, Snowflake } from "discord.js";
import { buildDictionaryIndex, DictionaryAhoIndexEntry, DictionaryIndexEntry, DictionaryTermIndex, MarkdownCharacterRegex } from "../utils/ReferenceUtils.js";
import { ArchiveChannel, ArchiveEntryReference } from "./ArchiveChannel.js";
import { ArchiveEntry } from "./ArchiveEntry.js";
import { DictionaryManager, DictionaryEntryStatus } from "./DictionaryManager.js";
import type { RepositoryManager } from "./RepositoryManager.js";
import { ArchiveChannelReference } from "./RepositoryConfigs.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { TemporaryCache } from "./TemporaryCache.js";

const INDEX_TIMEOUT_MS = 5 * 60 * 1000;

export type BasicDictionaryIndexEntry = {
    terms: string[];
    id: Snowflake;
}

export type ArchiveIndexEntry = {
    name: string;
    code: string;
    thread: string;
    url: string;
    path: string;
}

export type ArchiveIndex = {
    threadToId: Map<Snowflake, Snowflake>,
    codeToId: Map<string, Snowflake>,
    idToData: Map<string, ArchiveIndexEntry>,
}

export type Indexes = {
    dictionary: DictionaryTermIndex,
    archive: ArchiveIndex,
}

export class IndexManager {
    private cachedDictionaryIndex: TemporaryCache<DictionaryTermIndex>;
    private basicDictionaryIndexCache: TemporaryCache<BasicDictionaryIndexEntry[]>;
    private cachedArchiveIndex: TemporaryCache<ArchiveIndex>;
    private cachedArchiveChannelIds: Snowflake[] = [];

    constructor(
        private dictionaryManager: DictionaryManager,
        private repositoryManager: RepositoryManager,
        private archiveFolderPath: string,
    ) { 
        this.cachedDictionaryIndex = new TemporaryCache<DictionaryTermIndex>(
            INDEX_TIMEOUT_MS,
            () => this.buildDictionaryTermIndex()
        );
        this.basicDictionaryIndexCache = new TemporaryCache<BasicDictionaryIndexEntry[]>(
            INDEX_TIMEOUT_MS,
            () => this.buildBasicDictionaryIndex()
        );
        this.cachedArchiveIndex = new TemporaryCache<ArchiveIndex>(
            INDEX_TIMEOUT_MS,
            () => this.buildArchiveIndex()
        );
    }

    private getPostToSubmissionIndexPath() {
        return Path.join(this.archiveFolderPath, 'post_to_submission_index.json');
    }

    public async getPostToSubmissionIndex(): Promise<Record<string, Snowflake>> {
        const filePath = this.getPostToSubmissionIndexPath();
        if (!await fs.access(filePath).then(() => true).catch(() => false)) {
            await fs.writeFile(filePath, JSON.stringify({}, null, 2), 'utf-8');
            return {};
        } else {
            const content = await fs.readFile(filePath, 'utf-8');
            try {
                return JSON.parse(content);
            } catch (e) {
                console.error("Error parsing post_to_submission_index.json:", e);
                return {};
            }
        }
    }

    public async savePostToSubmissionIndex(index: Record<string, Snowflake>) {
        const filePath = this.getPostToSubmissionIndexPath();
        await fs.writeFile(filePath, JSON.stringify(index, null, 2), 'utf-8');
    }

    public async getSubmissionIDByPostID(postID: Snowflake): Promise<Snowflake | null> {
        const index = await this.getPostToSubmissionIndex();
        if (Object.prototype.hasOwnProperty.call(index, postID)) {
            return index[postID];
        } else {
            const channelReferences = await this.repositoryManager.getChannelReferences();
            for (const channelRef of channelReferences) {
                const channelPath = Path.join(this.archiveFolderPath, channelRef.path);
                const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
                const entries = archiveChannel.getData().entries;
                for (const entryRef of entries) {
                    const entryPath = Path.join(channelPath, entryRef.path);
                    const entry = await ArchiveEntry.fromFolder(entryPath);
                    if (entry) {
                        const post = entry.getData().post;
                        if (post && post.threadId === postID) {
                            await this.setSubmissionIDForPostID(postID, entry.getData().id);
                            return entry.getData().id;
                        }
                    }
                }
            }
            return null;
        }
    }

    public async setSubmissionIDForPostID(postID: Snowflake, submissionID: Snowflake) {
        const index = await this.getPostToSubmissionIndex();
        const prevValue = Object.prototype.hasOwnProperty.call(index, postID) ? index[postID] : null;
        if (prevValue === submissionID) {
            return;
        }
        index[postID] = submissionID;
        await this.savePostToSubmissionIndex(index);
    }

    public async deleteSubmissionIDForPostID(postID: Snowflake) {
        const index = await this.getPostToSubmissionIndex();
        if (Object.prototype.hasOwnProperty.call(index, postID)) {
            delete index[postID];
            await this.savePostToSubmissionIndex(index);
        }
    }

    public getArchiveChannelIds(): Snowflake[] {
        return this.cachedArchiveChannelIds;
    }

    public async updateArchiveChannelsCache(): Promise<void> {
        const guildHolder = this.repositoryManager.getGuildHolder();
        const categories = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS);
        const channels: Snowflake[] = [];
        const allChannels = await guildHolder.getGuild().channels.fetch();
        for (const channel of allChannels.values()) {
            if (channel && channel.type === ChannelType.GuildForum && categories.includes(channel.parentId as Snowflake)) {
                channels.push(channel.id);
            }
        }
        this.cachedArchiveChannelIds = channels;
    }

    public async buildBasicDictionaryIndex(): Promise<BasicDictionaryIndexEntry[]> {
        const dictionaryEntries = await this.dictionaryManager.listEntries();
        const basicIndex: BasicDictionaryIndexEntry[] = [];

        for (const entry of dictionaryEntries) {
            if (entry.status !== DictionaryEntryStatus.APPROVED) {
                continue;
            }
            basicIndex.push({
                terms: entry.terms || [],
                id: entry.id,
            });
        }

        return basicIndex;
    }


    public async buildDictionaryTermIndex(): Promise<DictionaryTermIndex> {
        const dictionaryEntries = await this.dictionaryManager.listEntries();
        const termToData: Map<string, DictionaryAhoIndexEntry[]> = new Map();

        const idToEntry = new Map<Snowflake, DictionaryIndexEntry>();
        for (const entry of dictionaryEntries) {
            if (entry.status !== DictionaryEntryStatus.APPROVED) {
                continue;
            }

            idToEntry.set(entry.id, {
                term: entry.terms[0],
                id: entry.id,
                url: entry.statusURL || entry.threadURL,
            });

            for (const rawTerm of entry.terms || []) {
                const normalized = rawTerm.toLowerCase().replace(MarkdownCharacterRegex, '');
                if (!normalized) {
                    continue;
                }

                if (!termToData.has(normalized)) {
                    termToData.set(normalized, []);
                }
                const arr = termToData.get(normalized)!;
                if (!arr.find(e => e.id === entry.id)) {
                    arr.push({
                        matchedTerm: rawTerm,
                        id: entry.id,
                    });
                }
            }
        }

        const termIndex: DictionaryTermIndex = {
            aho: buildDictionaryIndex(termToData),
            idToEntry,
        };
        return termIndex;
    }

    public async buildArchiveIndex(): Promise<ArchiveIndex> {
        const idToData = new Map<string, ArchiveIndexEntry>();
        const threadToId = new Map<Snowflake, Snowflake>();
        const codeToId = new Map<string, Snowflake>();
        
        await this.repositoryManager.iterateAllEntries(async (entry: ArchiveEntry, entryRef: ArchiveEntryReference, channelRef: ArchiveChannelReference) => {
            const data = entry.getData();
            if (!data.post) return;
           
            data.pastPostThreadIds.forEach(threadId => {
                threadToId.set(threadId, data.id);
            });
        
            data.reservedCodes.forEach(code => {
                codeToId.set(code.toUpperCase(), data.id);
            });

            codeToId.set(data.code.toUpperCase(), data.id);

            idToData.set(data.id, {
                name: data.name,
                code: data.code,
                thread: data.post.threadId,
                url: data.post.threadURL,
                path: channelRef.path + '/' + entryRef.path,
            });
        });

        return {
            idToData, threadToId, codeToId
        }
    }

    public async getDictionaryTermIndex(): Promise<DictionaryTermIndex> {
        return this.cachedDictionaryIndex.get();
    }

    public async getArchiveIndex(): Promise<ArchiveIndex> {
        return this.cachedArchiveIndex.get();
    }

    public async getBasicDictionaryIndex(): Promise<BasicDictionaryIndexEntry[]> {
        return this.basicDictionaryIndexCache.get();
    }

    public invalidateDictionaryTermIndex() {
        this.cachedDictionaryIndex.clear();
    }

    public invalidateBasicDictionaryIndex() {
        this.basicDictionaryIndexCache.clear();
    }

    public invalidateArchiveIndex() {
        this.cachedArchiveIndex.clear();
    }
}
