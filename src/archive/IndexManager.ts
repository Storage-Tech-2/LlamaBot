import fs from "fs/promises";
import Path from "path";
import { Snowflake } from "discord.js";
import { buildDictionaryIndex, DictionaryIndexEntry, DictionaryTermIndex } from "../utils/ReferenceUtils.js";
import { ArchiveChannel, ArchiveEntryReference } from "./ArchiveChannel.js";
import { ArchiveEntry } from "./ArchiveEntry.js";
import { DictionaryManager, ArchiveIndex, ArchiveIndexEntry } from "./DictionaryManager.js";
import type { RepositoryManager } from "./RepositoryManager.js";
import { ArchiveChannelReference } from "./RepositoryConfigs.js";

const INDEX_TIMEOUT_MS = 5 * 60 * 1000;
export class IndexManager {
    private cachedDictionaryIndex?: Promise<DictionaryTermIndex>;
    private dictionaryCacheInvalidateTimeout?: NodeJS.Timeout;
    private cachedArchiveIndex?: Promise<ArchiveIndex>;
    private archiveCacheInvalidateTimeout?: NodeJS.Timeout;

    constructor(
        private dictionaryManager: DictionaryManager,
        private repositoryManager: RepositoryManager,
        private archiveFolderPath: string,
    ) { }

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
            const channelReferences = this.repositoryManager.getChannelReferences();
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

    public async buildDictionaryTermIndex(): Promise<DictionaryTermIndex> {
        const dictionaryEntries = await this.dictionaryManager.listEntries();
        const termToData: Map<string, DictionaryIndexEntry[]> = new Map();

        for (const entry of dictionaryEntries) {
            for (const rawTerm of entry.terms || []) {
                const normalized = rawTerm.toLowerCase();
                if (!normalized) {
                    continue;
                }

                if (!termToData.has(normalized)) {
                    termToData.set(normalized, []);
                }
                const arr = termToData.get(normalized)!;
                if (!arr.find(e => e.id === entry.id)) {
                    arr.push({
                        term: rawTerm,
                        id: entry.id,
                        url: entry.statusURL || entry.threadURL,
                        status: entry.status,
                    });
                }
            }
        }

        const termIndex: DictionaryTermIndex = {
            aho: buildDictionaryIndex(termToData),
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
           
            threadToId.set(data.post.threadId, data.id);
            idToData.set(data.id, {
                code: data.code,
                url: data.post.threadURL,
                path: channelRef.path + '/' + entryRef.path,
            });
            codeToId.set(data.code, data.id);
        });

        return {
            idToData, threadToId, codeToId
        }
    }

    public async getDictionaryTermIndex(): Promise<DictionaryTermIndex> {
        clearTimeout(this.dictionaryCacheInvalidateTimeout);
        this.dictionaryCacheInvalidateTimeout = setTimeout(() => {
            this.invalidateDictionaryTermIndex();
        }, INDEX_TIMEOUT_MS);

        if (this.cachedDictionaryIndex) return this.cachedDictionaryIndex;
        this.cachedDictionaryIndex = this.buildDictionaryTermIndex();
        return this.cachedDictionaryIndex;
    }

    public async getArchiveIndex(): Promise<ArchiveIndex> {
        clearTimeout(this.archiveCacheInvalidateTimeout);
        this.archiveCacheInvalidateTimeout = setTimeout(() => {
            this.invalidateArchiveIndex();
        }, INDEX_TIMEOUT_MS);

        if (this.cachedArchiveIndex) return this.cachedArchiveIndex;
        this.cachedArchiveIndex = this.buildArchiveIndex();
        return this.cachedArchiveIndex;
    }

    public invalidateDictionaryTermIndex() {
        this.cachedDictionaryIndex = undefined;
    }

    public invalidateArchiveIndex() {
        this.cachedArchiveIndex = undefined;
    }
}
