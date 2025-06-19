import { Snowflake } from "discord.js";
import { Attachment } from "../submissions/Attachment.js";
import { Author } from "../submissions/Author.js";
import { Image } from "../submissions/Image.js";
import { Tag } from "../submissions/Tag.js";
import fs from "fs/promises";
import Path from "path";

export type DiscordPostReference = {
    forumId: Snowflake;
    threadId: Snowflake;
    threadURL: string;
    messageId: Snowflake;
    attachmentMessageId?: Snowflake;
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

    description: string;
    features: string[];
    considerations: string[];
    notes: string;

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

    public getFolderPath(): string {
        return this.folderPath;
    }

    public async save(): Promise<void> {
        const dataPath = Path.join(this.folderPath, 'data.json');
        return fs.writeFile(dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
    }

    public async load(): Promise<void> {
        const dataPath = Path.join(this.folderPath, 'data.json');
        this.data = JSON.parse(await fs.readFile(dataPath, 'utf-8')) as ArchiveEntryData;
    }

    public static async fromFolder(folder: string): Promise<ArchiveEntry> {
        const dataPath = Path.join(folder, 'data.json');
        const data: ArchiveEntryData = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
        const entry = new ArchiveEntry(data, folder);
        return entry;
    }

}