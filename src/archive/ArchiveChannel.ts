import { Snowflake } from "discord.js";
import fs from "fs/promises";
import Path from "path";
import { ArchiveChannelReference } from "./RepositoryConfigs.js";

export type ArchiveEntryReference = {
    id: Snowflake;
    name: string;
    code: string;
    timestamp?: number; // legacy
    archivedAt: number;
    updatedAt: number;
    path: string;
    tags: string[];
}

export type ArchiveChannelData = {
    id: Snowflake;
    name: string;
    code: string;
    category: string;
    description: string;
    currentCodeId: number;
    entries: ArchiveEntryReference[];
}

export class ArchiveChannel {
    private data: ArchiveChannelData;
    private folderPath: string;

    constructor(data: ArchiveChannelData, folderPath: string) {
        this.data = data;
        this.folderPath = folderPath;
    }

    public getData(): ArchiveChannelData {
        return this.data;
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
        this.data = JSON.parse(await fs.readFile(dataPath, 'utf-8')) as ArchiveChannelData;
        this.data.entries.forEach(entry => {
            if (!entry.archivedAt) entry.archivedAt = entry.timestamp || Date.now();
            if (!entry.updatedAt) entry.updatedAt = entry.archivedAt;
        });
    }

    public static newFromReference(reference: ArchiveChannelReference, channelPath: string): ArchiveChannel {
        const data = {
            id: reference.id,
            name: reference.name,
            code: reference.code,
            category: reference.category,
            description: reference.description,
            currentCodeId: 0,
            entries: []
        }
        const channel = new ArchiveChannel(data, channelPath);
        return channel;
    }

    public static async fromFolder(folder: string): Promise<ArchiveChannel> {
        const dataPath = Path.join(folder, 'data.json');
        const data: ArchiveChannelData = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
        data.entries.forEach(entry => {
            if (!entry.archivedAt) entry.archivedAt = entry.timestamp || Date.now();
            if (!entry.updatedAt) entry.updatedAt = entry.archivedAt;
        });
        const entry = new ArchiveChannel(data, folder);
        return entry;
    }

}