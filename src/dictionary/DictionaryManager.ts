import { Snowflake } from "discord.js";
import fs from "fs/promises";
import Path from "path";
import { Author } from "../submissions/Author.js";

export enum DictionaryEntryStatus {
    PENDING = "PENDING",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED"
}

export type DictionaryEntry = {
    id: Snowflake;
    terms: string[];
    authors: Author[];
    definition: string;
    threadURL: string;
    statusMessageID: Snowflake;
}

export class DictionaryManager {
    constructor(private folderPath: string) {

    }

    getEntriesPath(): string {
        return Path.join(this.folderPath, 'entries');
    }

    async getEntry(id: Snowflake): Promise<DictionaryEntry | null> {
        const entryPath = Path.join(this.getEntriesPath(), `${id}.json`);
        return fs.readFile(entryPath, 'utf-8')
            .then(data => JSON.parse(data) as DictionaryEntry)
            .catch(() => null);
    }

    async saveEntry(entry: DictionaryEntry): Promise<void> {
        const entryPath = Path.join(this.getEntriesPath(), `${entry.id}.json`);
        await fs.writeFile(entryPath, JSON.stringify(entry, null, 2), 'utf-8');
    }
    
    async deleteEntry(id: Snowflake): Promise<void> {
        const entryPath = Path.join(this.getEntriesPath(), `${id}.json`);
        await fs.unlink(entryPath);
    }

    async listEntries(): Promise<DictionaryEntry[]> {
        const entriesPath = this.getEntriesPath();
        const files = await fs.readdir(entriesPath);
        const entries: DictionaryEntry[] = [];
        for (const file of files) {
            if (file.endsWith('.json')) {
                const data = await fs.readFile(Path.join(entriesPath, file), 'utf-8');
                entries.push(JSON.parse(data) as DictionaryEntry);
            }
        }
        return entries;
    }
}