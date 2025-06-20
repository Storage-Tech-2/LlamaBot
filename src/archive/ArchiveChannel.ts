import { Snowflake } from "discord.js";
import fs from "fs/promises";
import Path from "path";
import { ArchiveChannelReference } from "./RepositoryConfigs.js";

export type ArchiveEntryReference = {
    id: Snowflake;
    name: string;
    code: string;
    timestamp: number;
    path: string;
}

export type ArchiveChannelData = {
    id: Snowflake;
    name: string;
    code: string;
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
    }

    public static newFromReference(reference: ArchiveChannelReference, channelPath: string): ArchiveChannel {
        const data = {
            id: reference.id,
            name: reference.name,
            code: reference.code,
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
        const entry = new ArchiveChannel(data, folder);
        return entry;
    }

}