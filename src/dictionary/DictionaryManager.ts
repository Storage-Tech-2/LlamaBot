import { AnyThreadChannel, ChannelType, EmbedBuilder, Message, MessageFlags, Snowflake } from "discord.js";
import fs from "fs/promises";
import Path from "path";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { GuildHolder } from "../GuildHolder.js";

export enum DictionaryEntryStatus {
    PENDING = "PENDING",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED"
}

export type DictionaryEntry = {
    id: Snowflake;
    terms: string[];
    definition: string;
    threadURL: string;
    status: DictionaryEntryStatus;
    statusMessageID?: Snowflake;
    updatedAt: number;
}

export class DictionaryManager {
    constructor(private guildHolder: GuildHolder, private folderPath: string) {

    }

    async init() {
        await fs.mkdir(this.getEntriesPath(), { recursive: true });
    }

    getEntriesPath(): string {
        return Path.join(this.folderPath, 'entries');
    }

    private getIndexPath(): string {
        return Path.join(this.folderPath, 'terms_index.json');
    }

    async getEntry(id: Snowflake): Promise<DictionaryEntry | null> {
        const entryPath = Path.join(this.getEntriesPath(), `${id}.json`);
        return fs.readFile(entryPath, 'utf-8')
            .then(data => this.hydrateEntry(JSON.parse(data) as DictionaryEntry))
            .catch(() => null);
    }

    async saveEntry(entry: DictionaryEntry, previousTerms?: string[]): Promise<void> {
        const entryPath = Path.join(this.getEntriesPath(), `${entry.id}.json`);
        await fs.mkdir(this.getEntriesPath(), { recursive: true });
        await fs.writeFile(entryPath, JSON.stringify(entry, null, 2), 'utf-8');
        await this.upsertIndexForEntry(entry, previousTerms);
    }
    
    async deleteEntry(id: Snowflake): Promise<void> {
        const entryPath = Path.join(this.getEntriesPath(), `${id}.json`);
        await fs.unlink(entryPath).catch(() => {});
        await this.removeFromIndex(id);
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

    async handleDictionaryMessage(message: Message) {
        if (!message.channel.isThread()) {
            return;
        }

        const dictionaryChannelId = this.guildHolder.getConfigManager().getConfig(GuildConfigs.DICTIONARY_CHANNEL_ID);
        if (!dictionaryChannelId || message.channel.parentId !== dictionaryChannelId) {
            return;
        }

        const thread = message.channel as AnyThreadChannel;
        const entry = await this.ensureEntryForThread(thread);
        if (!entry) {
            return;
        }

        if (!entry.definition && message.content) {
            entry.definition = message.content;
            entry.updatedAt = Date.now();
            await this.saveEntry(entry);
            await this.updateStatusMessage(entry, thread);
        }
    }

    async ensureEntryForThread(thread: AnyThreadChannel): Promise<DictionaryEntry | null> {
        let entry = await this.getEntry(thread.id);
        if (entry) {
            await this.ensureStatusMessage(entry, thread);
            await this.applyStatusTag(entry, thread);
            await this.ensureEntryIndexed(entry);
            return entry;
        }

        if (thread.parent?.type !== ChannelType.GuildForum) {
            return null;
        }

        const starterMessage = await thread.fetchStarterMessage().catch(() => null);
        const definition = starterMessage?.content ?? '';

        entry = {
            id: thread.id,
            terms: [thread.name],
            definition,
            threadURL: thread.url,
            status: DictionaryEntryStatus.PENDING,
            updatedAt: Date.now(),
        };

        const statusMessage = await this.sendStatusMessage(thread, entry);
        if (statusMessage) {
            entry.statusMessageID = statusMessage.id;
        }
        await this.saveEntry(entry);
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
            await targetThread.setArchived(false).catch(() => {});
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
                await targetThread.setArchived(true).catch(() => {});
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
            await targetThread.setArchived(false).catch(() => {});
        }

        try {
            const embed = this.buildStatusEmbed(entry);

            if (entry.statusMessageID) {
                const statusMessage = await targetThread.messages.fetch(entry.statusMessageID).catch(() => null);
                if (statusMessage) {
                    await statusMessage.edit({ embeds: [embed] }).catch(() => {});
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
        } finally {
            if (wasArchived) {
                await targetThread.setArchived(true).catch(() => {});
            }
        }
    }

    private async fetchThread(threadId: Snowflake): Promise<AnyThreadChannel | null> {
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
        const message = await thread.send({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] }).catch(() => null);
        if (message) {
            await message.pin().catch(() => {});
        }
        return message;
    }

    private buildStatusEmbed(entry: DictionaryEntry): EmbedBuilder {
        const embed = new EmbedBuilder();
        embed.setTitle(`Dictionary Entry: ${entry.terms[0] || 'Entry'}`);
        embed.setColor(this.statusToColor(entry.status));

        embed.setDescription(this.trim(entry.definition || 'No definition provided yet.', 1800));

        embed.addFields(
            { name: 'Terms', value: entry.terms.length ? entry.terms.join(', ') : 'None', inline: false },
            { name: 'Status', value: this.statusLabel(entry.status), inline: true },
            { name: 'Last Updated', value: `<t:${Math.floor((entry.updatedAt || Date.now()) / 1000)}:R>`, inline: true },
        );

        return embed;
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

    private trim(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }
        return `${text.slice(0, maxLength - 3)}...`;
    }

    private hydrateEntry(raw: DictionaryEntry): DictionaryEntry {
        return {
            id: raw.id,
            terms: raw.terms || [],
            definition: raw.definition || '',
            threadURL: raw.threadURL || '',
            status: raw.status || DictionaryEntryStatus.PENDING,
            statusMessageID: raw.statusMessageID,
            updatedAt: raw.updatedAt || Date.now(),
        };
    }

    private normalizeTerm(term: string): string {
        return term.trim().toLowerCase();
    }

    private async loadTermIndex() {
        try {
            const data = await fs.readFile(this.getIndexPath(), 'utf-8');
            const parsed: Record<string, Snowflake[]> = JSON.parse(data);
            return new Map(Object.entries(parsed).map(([term, ids]) => [term, new Set(ids)]));
        } catch {
            return await this.rebuildTermIndex();
        }
    }

    private async rebuildTermIndex() {
        const entries = await this.listEntries();
        const index: Map<string, Set<Snowflake>> = new Map();
        for (const entry of entries) {
            const normalizedTerms = (entry.terms || []).map(t => this.normalizeTerm(t)).filter(Boolean);
            for (const term of normalizedTerms) {
                if (!index.has(term)) {
                    index.set(term, new Set());
                }
                index.get(term)!.add(entry.id);
            }
        }
        await this.persistTermIndex(index);
        return index;
    }

    private async persistTermIndex(index: Map<string, Set<Snowflake>>) {
        const obj: Record<string, Snowflake[]> = {};
        for (const [term, ids] of index.entries()) {
            obj[term] = Array.from(ids);
        }
        await fs.mkdir(this.folderPath, { recursive: true });
        await fs.writeFile(this.getIndexPath(), JSON.stringify(obj, null, 2), 'utf-8');
    }

    private async upsertIndexForEntry(entry: DictionaryEntry, previousTerms?: string[]) {
        const termIndex = await this.loadTermIndex();
        const prev = previousTerms ? previousTerms.map(t => this.normalizeTerm(t)) : [];
        const newTerms = (entry.terms || []).map(t => this.normalizeTerm(t)).filter(t => t.length > 0);

        // remove old links
        if (prev.length) {
            for (const term of prev) {
                const set = termIndex.get(term);
                if (set) {
                    set.delete(entry.id);
                    if (set.size === 0) {
                        termIndex.delete(term);
                    }
                }
            }
        }

        for (const term of newTerms) {
            if (!termIndex.has(term)) {
                termIndex.set(term, new Set());
            }
            termIndex.get(term)!.add(entry.id);
        }

        await this.persistTermIndex(termIndex);
    }

    private async removeFromIndex(id: Snowflake) {
        const termIndex = await this.loadTermIndex();
        let changed = false;
        for (const [term, ids] of termIndex.entries()) {
            if (ids.has(id)) {
                ids.delete(id);
                changed = true;
                if (ids.size === 0) {
                    termIndex.delete(term);
                }
            }
        }
        if (changed) {
            await this.persistTermIndex(termIndex);
        }
    }

    private async ensureEntryIndexed(entry: DictionaryEntry) {
        await this.upsertIndexForEntry(entry);
    }

    private async findDuplicateEntries(entry: DictionaryEntry): Promise<{ term: string, ids: Snowflake[] }[]> {
        const termIndex = await this.loadTermIndex();
        const duplicates: { term: string, ids: Snowflake[] }[] = [];
        for (const term of entry.terms || []) {
            const normalized = this.normalizeTerm(term);
            const ids = termIndex.get(normalized);
            if (!ids) continue;
            const others = Array.from(ids).filter(id => id !== entry.id);
            if (others.length > 0) {
                duplicates.push({ term, ids: others });
            }
        }
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
            const references: string[] = [];
            for (const id of dup.ids) {
                const other = await this.getEntry(id);
                if (other?.threadURL) {
                    references.push(`[${id}](${other.threadURL})`);
                } else {
                    references.push(id);
                }
            }
            lines.push(`**${dup.term}** duplicates ${references.join(', ')}`);
        }

        await targetThread.send({
            content: `Duplicate dictionary terms detected:\n${lines.join('\n')}`,
            flags: [MessageFlags.SuppressNotifications],
        }).catch(() => {});
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
            await targetThread.setArchived(false).catch(() => {});
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
                await targetThread.setAppliedTags(Array.from(currentTags)).catch(() => {});
            }
        } finally {
            if (wasArchived) {
                await targetThread.setArchived(true).catch(() => {});
            }
        }
    }
}
