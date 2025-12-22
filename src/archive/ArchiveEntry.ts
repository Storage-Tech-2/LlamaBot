import { Snowflake } from "discord.js";
import { Attachment } from "../submissions/Attachment.js";
import { Author } from "../submissions/Author.js";
import { Image } from "../submissions/Image.js";
import { Tag } from "../submissions/Tag.js";
import fs from "fs/promises";
import Path from "path";
import { StyleInfo, SubmissionRecords } from "../utils/MarkdownUtils.js";

export type DiscordPostReference = {
    forumId: Snowflake;
    threadId: Snowflake;
    threadURL: string;
    continuingMessageIds: Snowflake[];
    uploadMessageId: Snowflake;
}

export type ArchiveEntryData = {
    id: Snowflake;
    name: string;
    code: string;
    authors: Author[];
    endorsers: Author[];
    tags: Tag[];

    images: Image[];
    attachments: Attachment[];

    records: SubmissionRecords;
    styles: Record<string, StyleInfo>;

    /// For routing
    post?: DiscordPostReference;

    timestamp: number;
}

export class ArchiveEntry {
    private data: ArchiveEntryData;
    private folderPath: string;

    constructor(data: ArchiveEntryData, folderPath: string) {
        this.data = data;
        this.folderPath = folderPath;
    }

    public getData(): ArchiveEntryData {
        return this.data;
    }

    public setData(data: ArchiveEntryData): void {
        this.data = data;
    }

    public getFolderPath(): string {
        return this.folderPath;
    }

    public getDataPath(): string {
        return Path.join(this.folderPath, 'data.json');
    }

    public async save(): Promise<void> {
        const dataPath = this.getDataPath();
        return fs.writeFile(dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
    }

    public async load(): Promise<void> {
        const dataPath = this.getDataPath();
        this.data = JSON.parse(await fs.readFile(dataPath, 'utf-8')) as ArchiveEntryData;
    }

    public static async fromFolder(folder: string): Promise<ArchiveEntry | null> {
        const dataPath = Path.join(folder, 'data.json');
        try {
            const data: ArchiveEntryData = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
            const entry = new ArchiveEntry(data, folder);
            return entry;
        } catch (error) {
            return null;
        }
    }

}