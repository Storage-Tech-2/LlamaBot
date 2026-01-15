import { ActionRowBuilder, AnyThreadChannel, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Message, MessageFlags, Snowflake } from "discord.js";
import fs from "fs/promises";
import Path from "path";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { GuildHolder } from "../GuildHolder.js";
import { DictionaryTermIndex, Reference, tagReferences, transformOutputWithReferencesForDiscord, MarkdownCharacterRegex, transformOutputWithReferencesForEmbeddings } from "../utils/ReferenceUtils.js";
import { ArchiveIndex, BasicDictionaryIndexEntry, IndexManager } from "./IndexManager.js";
import { RepositoryManager } from "./RepositoryManager.js";
import { Lock } from "../utils/Lock.js";
import { chunkArray, truncateStringWithEllipsis } from "../utils/Util.js";
import { EditDictionaryEntryButton } from "../components/buttons/EditDictionaryEntryButton.js";
import { buildDictionarySlug } from "../utils/SlugUtils.js";
import { generateDocumentEmbeddings } from "../llm/EmbeddingUtils.js";

export enum DictionaryEntryStatus {
    PENDING = "PENDING",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED"
}

export type DictionaryEmbeddingsEntry = {
    id: string;
    updated_at: number;
    embedding: string; // base64 encoded string
}

export type DictionaryEntry = {
    id: Snowflake;
    terms: string[];
    definition: string;
    threadURL: string;
    statusURL: string;
    status: DictionaryEntryStatus;
    statusMessageID?: Snowflake;
    updatedAt: number;
    references: Reference[];
    referencedBy: string[];
}

export class DictionaryManager {
    private indexManager?: IndexManager;

    private entryLock: Lock = new Lock();

    constructor(
        private guildHolder: GuildHolder,
        private folderPath: string,
        private repositoryManager: RepositoryManager,
    ) {

    }

    async init() {
        await fs.mkdir(this.getEntriesPath(), { recursive: true });
    }

    getEntriesPath(): string {
        return Path.join(this.folderPath, 'entries');
    }

    getConfigPath(): string {
        return Path.join(this.folderPath, 'config.json');
    }

    async getEntry(id: Snowflake): Promise<DictionaryEntry | null> {
        const entryPath = Path.join(this.getEntriesPath(), `${id}.json`);
        return fs.readFile(entryPath, 'utf-8')
            .then(data => this.hydrateEntry(JSON.parse(data) as DictionaryEntry))
            .catch(() => null);
    }

    public haveTermsChanged(oldTerms: string[], newTerms: string[]): boolean {
        if (oldTerms.length !== newTerms.length) {
            return true;
        }
        const oldSet = new Set(oldTerms);
        const newSet = new Set(newTerms);
        if (oldSet.size !== newSet.size) {
            return true;
        }
        for (const term of oldSet) {
            if (!newSet.has(term)) {
                return true;
            }
        }
        return false;
    }

    public getDictionaryEmbeddingPath(): string {
        return Path.join(this.folderPath, 'embeddings.json');
    }

    async rebuildConfigIndex(): Promise<void> {
        const configPath = this.getConfigPath();
        const entries = await this.listEntries();
        const configData = {
            entries: entries.filter(entry => entry.status === DictionaryEntryStatus.APPROVED).map(entry => {
                return {
                    id: entry.id,
                    terms: entry.terms,
                    summary: truncateStringWithEllipsis(entry.definition, 200),
                    updatedAt: entry.updatedAt,
                };
            })
        };
        await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf-8');
        await this.repositoryManager.add(configPath);

        const embeddings = await this.getEmbeddings();
        const embeddingsMap = new Map<string, DictionaryEmbeddingsEntry>(embeddings.map(e => [e.id, e]));
        const seenCodes = new Set<string>();
        const toRefreshEmbeddings = new Set<string>();


        for (const entry of configData.entries) {
            const data = await this.getEntry(entry.id);
            if (!data) {
                continue;
            }
            seenCodes.add(entry.id);
            const existingEmbedding = embeddingsMap.get(entry.id);
            if (!existingEmbedding || existingEmbedding.updated_at !== data.updatedAt) {
                toRefreshEmbeddings.add(entry.id);
            }
        }

        // now handle embeddings refresh
        const embeddingsToDelete: string[] = [];
        for (const embeddingEntry of embeddings) {
            if (!seenCodes.has(embeddingEntry.id)) {
                embeddingsToDelete.push(embeddingEntry.id);
            }
        }

        for (const code of embeddingsToDelete) {
            embeddingsMap.delete(code);
        }

        const toRefreshEmbeddingsChunked = chunkArray(Array.from(toRefreshEmbeddings), 20);
        for (const chunk of toRefreshEmbeddingsChunked) {
            const entries = (await Promise.all(chunk.map(async entryPath => {
                const entryData = await this.getEntry(entryPath);
                return entryData;
            }))).filter((e): e is DictionaryEntry => e !== null);


            // get text
            const texts = entries.map(entryData => {
                return transformOutputWithReferencesForEmbeddings(entryData.definition, entryData.references);
            });

            const result = await generateDocumentEmbeddings(texts).catch((e) => {
                console.error("Error generating document embeddings for dictionary entries:", e);
                return null;
            });
            
            if (result === null) {
                continue;
            }

            for (let i = 0; i < entries.length; i++) {
                const entryData = entries[i];
                const embedding = result.embeddings[i];
                embeddingsMap.set(entryData.id, {
                    id: entryData.id,
                    updated_at: entryData.updatedAt,
                    embedding: embedding
                });
            }
        }

        if (toRefreshEmbeddings.size > 0 || embeddingsToDelete.length > 0) {
            const newEmbeddings = Array.from(embeddingsMap.values());
            await fs.writeFile(this.getDictionaryEmbeddingPath(), JSON.stringify(newEmbeddings, null, 2), 'utf-8');
            await this.repositoryManager.add(this.getDictionaryEmbeddingPath());
        }
    }

    public async getEmbeddings(): Promise<DictionaryEmbeddingsEntry[]> {
        const embeddingPath = this.getDictionaryEmbeddingPath();
        return fs.readFile(embeddingPath, 'utf-8')
            .then(data => JSON.parse(data) as DictionaryEmbeddingsEntry[])
            .catch(() => []);
    }

    getLock(): Lock {
        return this.repositoryManager.getLock();
    }

    async saveEntry(entry: DictionaryEntry): Promise<void> {
        const oldEntry = await this.getEntry(entry.id);
        const entryPath = Path.join(this.getEntriesPath(), `${entry.id}.json`);
        await fs.mkdir(this.getEntriesPath(), { recursive: true });
        await fs.writeFile(entryPath, JSON.stringify(entry, null, 2), 'utf-8');
        await this.repositoryManager.add(entryPath).catch(() => { });
        const rebuildNeeded = !oldEntry || oldEntry.status !== entry.status || this.haveTermsChanged(oldEntry.terms, entry.terms);
        await this.rebuildConfigIndex().catch((e) => {
            console.error("Error rebuilding dictionary config index:", e);
        });
        this.invalidateDictionaryTermIndex();
        if (rebuildNeeded) {
            this.repositoryManager.getGuildHolder().requestRetagging();
        }
    }

    async saveEntryAndPush(entry: DictionaryEntry): Promise<void> {
        await this.repositoryManager.getLock().acquire();
        await this.saveEntry(entry);
        await this.repositoryManager.commit(`Updated dictionary entry ${entry.terms[0]}`).catch(() => { });
        await this.repositoryManager.push().catch(() => { });
        this.repositoryManager.getLock().release();
    }

    async deleteEntry(entry: DictionaryEntry): Promise<void> {
        await this.repositoryManager.getLock().acquire();
        const entryPath = Path.join(this.getEntriesPath(), `${entry.id}.json`);
        await this.repositoryManager.rm(entryPath).catch(() => { });
        await fs.unlink(entryPath).catch(() => { });
        await fs.mkdir(this.getEntriesPath(), { recursive: true });
        await this.rebuildConfigIndex();
        this.invalidateDictionaryTermIndex();

        await this.repositoryManager.add(this.getConfigPath()).catch(() => { });

        await this.repositoryManager.commit(`Deleted dictionary entry ${entry.terms[0]}`).catch(() => { });
        await this.repositoryManager.push().catch(() => { });

        this.repositoryManager.getLock().release();

        this.repositoryManager.getGuildHolder().requestRetagging();
    }

    async listEntries(): Promise<DictionaryEntry[]> {
        const entriesPath = this.getEntriesPath();
        await fs.mkdir(entriesPath, { recursive: true });
        const files = await fs.readdir(entriesPath);
        const entries: DictionaryEntry[] = [];
        for (const file of files) {
            if (file.endsWith('.json')) {
                const data = await fs.readFile(Path.join(entriesPath, file), 'utf-8');
                entries.push(this.hydrateEntry(JSON.parse(data) as DictionaryEntry));
            }
        }
        return entries;
    }

    async iterateEntries(callback: (entry: DictionaryEntry) => Promise<void>): Promise<void> {
        const entriesPath = this.getEntriesPath();
        await fs.mkdir(entriesPath, { recursive: true });
        const files = await fs.readdir(entriesPath);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const data = await fs.readFile(Path.join(entriesPath, file), 'utf-8');
                const entry = this.hydrateEntry(JSON.parse(data) as DictionaryEntry);
                await callback(entry);
            }
        }
    }

    async handleDictionaryMessage(message: Message) {
        if (!message.channel.isThread()) {
            return;
        }

        const dictionaryChannelId = this.guildHolder.getConfigManager().getConfig(GuildConfigs.DICTIONARY_CHANNEL_ID);
        if (!dictionaryChannelId || message.channel.parentId !== dictionaryChannelId) {
            return;
        }

        const thread = message.channel as AnyThreadChannel;
        await this.ensureEntryForThread(thread);
    }

    async ensureEntryForThread(thread: AnyThreadChannel): Promise<DictionaryEntry | null> {
        if (thread.parent?.type !== ChannelType.GuildForum) {
            return null;
        }

        await this.entryLock.acquire();

        let entry = await this.getEntry(thread.id);
        if (entry) {
            await this.ensureStatusMessage(entry, thread);
            this.entryLock.release();
            return entry;
        }


        const starterMessage = await thread.fetchStarterMessage().catch(() => null);
        const definition = starterMessage?.content.trim() ?? '';

        const terms = thread.name.replace(MarkdownCharacterRegex, '').split(',').map(t => t.trim()).filter(t => t.length > 0);
        entry = {
            id: thread.id,
            terms: terms,
            definition,
            threadURL: thread.url,
            statusURL: '',
            status: DictionaryEntryStatus.PENDING,
            updatedAt: Date.now(),
            references: await tagReferences(definition, [], this.guildHolder, thread.id).catch(() => []),
            referencedBy: [],
        };

        const statusMessage = await this.sendStatusMessage(thread, entry).catch((e) => {
            console.error("Error sending status message for new dictionary entry:", e);
            return null;
        });


        if (statusMessage) {
            entry.statusMessageID = statusMessage.id;
            entry.statusURL = statusMessage.url;
        }

        await this.saveEntry(entry).catch((e) => {
            console.error("Error saving new dictionary entry:", e);
        });

        this.entryLock.release();

        await this.warnIfDuplicate(entry, thread);
        await this.applyStatusTag(entry, thread);

        return entry;
    }

    async ensureStatusMessage(entry: DictionaryEntry, thread?: AnyThreadChannel) {
        if (entry.statusMessageID) {
            return;
        }

        const targetThread = thread ?? await this.fetchThread(entry.id);
        if (!targetThread) {
            return;
        }

        const wasArchived = targetThread.archived;
        if (wasArchived) {
            await targetThread.setArchived(false).catch(() => { });
        }

        try {
            if (entry.statusMessageID) {
                const existing = await targetThread.messages.fetch(entry.statusMessageID).catch(() => null);
                if (existing) {
                    return;
                }
            }

            const statusMessage = await this.sendStatusMessage(targetThread, entry);
            if (statusMessage) {
                entry.statusMessageID = statusMessage.id;
                await this.saveEntry(entry);
            }
        } finally {
            if (wasArchived) {
                await targetThread.setArchived(true).catch(() => { });
            }
        }
    }

    async updateStatusMessage(entry: DictionaryEntry, thread?: AnyThreadChannel) {
        const targetThread = thread ?? await this.fetchThread(entry.id);
        if (!targetThread) {
            return;
        }

        const wasArchived = targetThread.archived;
        if (wasArchived) {
            await targetThread.setArchived(false).catch(() => { });
        }

        try {
            const embed = this.buildStatusEmbed(entry);

            if (entry.statusMessageID) {
                const statusMessage = await targetThread.messages.fetch(entry.statusMessageID).catch(() => null);
                if (statusMessage) {
                    await statusMessage.edit({ embeds: [embed], components: this.buildStatusComponents(entry) }).catch((e) => {
                        console.error("Error editing status message for dictionary entry:", e);
                    });
                    await this.applyStatusTag(entry, targetThread);
                    return;
                }
            }

            const statusMessage = await this.sendStatusMessage(targetThread, entry);
            if (statusMessage) {
                entry.statusMessageID = statusMessage.id;
                await this.saveEntry(entry);
            }
            await this.applyStatusTag(entry, targetThread);
        } catch (e) {
            console.error("Error updating status message for dictionary entry:", e);
        } finally {
            if (wasArchived) {
                await targetThread.setArchived(true).catch(() => { });
            }
        }
    }

    public async fetchThread(threadId: Snowflake): Promise<AnyThreadChannel | null> {
        const channel = await this.guildHolder.getGuild().channels.fetch(threadId).catch(() => null);
        if (!channel || !channel.isThread()) {
            return null;
        }
        return channel as AnyThreadChannel;
    }

    private async sendStatusMessage(thread: AnyThreadChannel, entry: DictionaryEntry) {
        if (!thread.isTextBased()) {
            return null;
        }
        const embed = this.buildStatusEmbed(entry);
        const message = await thread.send({ embeds: [embed], components: this.buildStatusComponents(entry), flags: [MessageFlags.SuppressNotifications] }).catch(() => null);
        if (message) {
            await message.pin().catch(() => { });
        }
        return message;
    }

    private buildStatusEmbed(entry: DictionaryEntry): EmbedBuilder {
        const embed = new EmbedBuilder();
        embed.setTitle(`Dictionary Entry: ${entry.terms[0] || 'Entry'}`);
        embed.setColor(this.statusToColor(entry.status));

        const def = transformOutputWithReferencesForDiscord(entry.definition, entry.references);
        embed.setDescription(truncateStringWithEllipsis(def || 'No definition provided yet.', 3500));

        embed.addFields(
            { name: 'Terms', value: truncateStringWithEllipsis(entry.terms.length ? entry.terms.join(', ') : 'None', 150), inline: false },
            { name: 'Status', value: this.statusLabel(entry.status), inline: true },
            { name: 'References', value: `${entry.referencedBy.length}`, inline: true },
            { name: 'Last Updated', value: `<t:${Math.floor((entry.updatedAt || Date.now()) / 1000)}:R>`, inline: true },
        );

        return embed;
    }

    private buildStatusComponents(entry: DictionaryEntry): ActionRowBuilder<ButtonBuilder>[] {
        const editButton = new EditDictionaryEntryButton().getBuilder(entry.id, entry.status === DictionaryEntryStatus.APPROVED);
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(editButton);

        // check if website URL is configured
        const websiteURL = this.guildHolder.getConfigManager().getConfig(GuildConfigs.WEBSITE_URL);
        if (websiteURL && entry.status === DictionaryEntryStatus.APPROVED) {
            const postURLObj = new URL(websiteURL);
            postURLObj.pathname = `/dictionary/${buildDictionarySlug(entry.id, entry.terms)}`;
            const viewButton = new ButtonBuilder()
                .setLabel('View on Website')
                .setStyle(ButtonStyle.Link) // Link button
                .setURL(postURLObj.href);
            row.addComponents(viewButton);
        }

        return [row];
    }

    private statusToColor(status: DictionaryEntryStatus): number {
        switch (status) {
            case DictionaryEntryStatus.APPROVED:
                return 0x00ff00;
            case DictionaryEntryStatus.REJECTED:
                return 0xff0000;
            default:
                return 0x0099ff;
        }
    }

    private statusLabel(status: DictionaryEntryStatus): string {
        switch (status) {
            case DictionaryEntryStatus.APPROVED:
                return 'Approved';
            case DictionaryEntryStatus.REJECTED:
                return 'Rejected';
            default:
                return 'Pending';
        }
    }

    private hydrateEntry(raw: DictionaryEntry): DictionaryEntry {
        return {
            id: raw.id,
            terms: raw.terms || [],
            definition: raw.definition || '',
            threadURL: raw.threadURL || '',
            statusURL: raw.statusURL || '',
            status: raw.status || DictionaryEntryStatus.PENDING,
            statusMessageID: raw.statusMessageID,
            updatedAt: raw.updatedAt || Date.now(),
            references: raw.references || [],
            referencedBy: raw.referencedBy || []
        };
    }

    public setIndexManager(indexManager: IndexManager) {
        this.indexManager = indexManager;
    }

    public getIndexManager(): IndexManager {
        if (!this.indexManager) {
            throw new Error('IndexManager not initialized');
        }
        return this.indexManager;
    }

    public async getDictionaryTermIndex(): Promise<DictionaryTermIndex> {
        return this.getIndexManager().getDictionaryTermIndex();
    }

    public async getArchiveIndex(): Promise<ArchiveIndex> {
        return this.getIndexManager().getArchiveIndex();
    }

    public async getBasicDictionaryIndex(): Promise<BasicDictionaryIndexEntry[]> {
        return this.getIndexManager().getBasicDictionaryIndex();
    }

    public invalidateDictionaryTermIndex() {
        this.getIndexManager().invalidateDictionaryTermIndex();
        this.getIndexManager().invalidateBasicDictionaryIndex();
    }

    public invalidateArchiveIndex() {
        this.getIndexManager().invalidateArchiveIndex();
    }

    private async findDuplicateEntries(entry: DictionaryEntry): Promise<{
        matches: string[],
        entry: DictionaryEntry
    }[]> {
        const terms = await this.listEntries();

        const duplicates: {
            matches: string[],
            entry: DictionaryEntry
        }[] = [];

        const entryNormalizedTerms = entry.terms.map(t => t.toLowerCase().replace(MarkdownCharacterRegex, ''));

        terms.forEach(e => {
            if (e.id === entry.id) {
                return;
            }

            const matches: string[] = [];
            e.terms.forEach(t => {
                const normalized = t.toLowerCase().replace(MarkdownCharacterRegex, '');
                if (entryNormalizedTerms.includes(normalized)) {
                    matches.push(t);
                }
            });

            if (matches.length > 0 && e.id !== entry.id) {
                duplicates.push({ matches, entry: e });
            }
        });

        return duplicates;
    }

    public async warnIfDuplicate(entry: DictionaryEntry, thread?: AnyThreadChannel) {
        const targetThread = thread ?? await this.fetchThread(entry.id);
        if (!targetThread || !targetThread.isTextBased()) {
            return;
        }

        const duplicates = await this.findDuplicateEntries(entry);
        if (duplicates.length === 0) {
            return;
        }

        const lines: string[] = [];
        for (const dup of duplicates) {
            lines.push(`**${dup.matches.join(', ')}** in ${dup.entry.threadURL}`);
        }

        await targetThread.send({
            content: `Potentially duplicate dictionary terms detected:\n${lines.join('\n')}`,
            flags: [MessageFlags.SuppressNotifications],
        }).catch(() => { });
    }

    private statusTagNameFor(status: DictionaryEntryStatus): string {
        switch (status) {
            case DictionaryEntryStatus.APPROVED:
                return 'Approved';
            case DictionaryEntryStatus.REJECTED:
                return 'Rejected';
            default:
                return 'Pending';
        }
    }

    private statusTagNames(): string[] {
        return ['Pending', 'Approved', 'Rejected'];
    }

    private async applyStatusTag(entry: DictionaryEntry, thread?: AnyThreadChannel) {
        const targetThread = thread ?? await this.fetchThread(entry.id);
        if (!targetThread || !targetThread.parent || targetThread.parent.type !== ChannelType.GuildForum) {
            return;
        }

        const parent = targetThread.parent;
        const desiredName = this.statusTagNameFor(entry.status);
        const desiredTag = parent.availableTags.find(tag => tag.name === desiredName);
        if (!desiredTag || !desiredTag.id) {
            return;
        }

        const wasArchived = targetThread.archived;
        if (wasArchived) {
            await targetThread.setArchived(false).catch(() => { });
        }

        try {
            const currentTags = new Set(targetThread.appliedTags || []);
            const removableTags = parent.availableTags
                .filter(tag => this.statusTagNames().includes(tag.name))
                .map(tag => tag.id)
                .filter(Boolean) as string[];

            let changed = false;
            for (const tagId of removableTags) {
                if (tagId !== desiredTag.id && currentTags.has(tagId)) {
                    currentTags.delete(tagId);
                    changed = true;
                }
            }
            if (!currentTags.has(desiredTag.id)) {
                currentTags.add(desiredTag.id);
                changed = true;
            }

            if (changed) {
                await targetThread.setAppliedTags(Array.from(currentTags)).catch(() => { });
            }
        } finally {
            if (wasArchived) {
                await targetThread.setArchived(true).catch(() => { });
            }
        }
    }
}
