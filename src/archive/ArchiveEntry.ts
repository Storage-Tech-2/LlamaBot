import { Snowflake } from "discord.js";
import { Attachment } from "../submissions/Attachment.js";
import { Author } from "../submissions/Author.js";
import { Image } from "../submissions/Image.js";
import { Tag } from "../submissions/Tag.js";
import fs from "fs/promises";
import Path from "path";
import { StyleInfo, SubmissionRecords } from "../utils/MarkdownUtils.js";
import { Reference } from "../utils/ReferenceUtils.js";

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

    reservedCodes: string[];
    pastPostThreadIds: Snowflake[];

    authors: Author[];
    endorsers: Author[];
    tags: Tag[];

    images: Image[];
    attachments: Attachment[];

    records: SubmissionRecords;
    styles: Record<string, StyleInfo>;
    references: Reference[];
    author_references: Reference[];

    /// For routing
    post?: DiscordPostReference;

    timestamp?: number; // legacy
    archivedAt: number;
    updatedAt: number;
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

    public async savePrivate(): Promise<void> {
        const dataPath = this.getDataPath();

        const dataCleaned: ArchiveEntryData = {
            id: this.data.id,
            name: this.data.name,
            code: this.data.code,
            reservedCodes: this.data.reservedCodes,
            pastPostThreadIds: this.data.pastPostThreadIds,
            authors: this.data.authors,
            endorsers: this.data.endorsers,
            tags: this.data.tags,
            images: this.data.images,
            attachments: this.data.attachments,
            records: this.data.records,
            styles: this.data.styles,
            references: this.data.references,
            author_references: this.data.author_references,
            post: this.data.post,
            archivedAt: this.data.archivedAt,
            updatedAt: this.data.updatedAt
        };

        return fs.writeFile(dataPath, JSON.stringify(dataCleaned, null, 2), 'utf-8');
    }

    public async load(): Promise<void> {
        const dataPath = this.getDataPath();
        this.data = JSON.parse(await fs.readFile(dataPath, 'utf-8')) as ArchiveEntryData;
        if (!this.data.references) this.data.references = [];
        if (!this.data.author_references) this.data.author_references = [];
        if (!this.data.archivedAt) this.data.archivedAt = this.data.timestamp || Date.now();
        if (!this.data.updatedAt) this.data.updatedAt = this.data.archivedAt;
        if (!this.data.reservedCodes) this.data.reservedCodes = [this.data.code];
        if (!this.data.pastPostThreadIds) this.data.pastPostThreadIds = this.data.post ? [this.data.post.threadId] : [];
    }

    public static async fromFolder(folder: string): Promise<ArchiveEntry | null> {
        const dataPath = Path.join(folder, 'data.json');
        try {
            const data: ArchiveEntryData = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
            if (!data.references) data.references = [];
            if (!data.author_references) data.author_references = [];
            if (!data.archivedAt) data.archivedAt = data.timestamp || Date.now();
            if (!data.updatedAt) data.updatedAt = data.archivedAt;
            if (!data.reservedCodes) data.reservedCodes = [data.code];
            if (!data.pastPostThreadIds) data.pastPostThreadIds = data.post ? [data.post.threadId] : [];
            const entry = new ArchiveEntry(data, folder);
            return entry;
        } catch (error) {
            return null;
        }
    }

}