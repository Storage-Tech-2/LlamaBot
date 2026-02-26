import { Snowflake } from "discord.js";
import fs from "fs/promises";
import { ArchiveChannelReference } from "./RepositoryConfigs.js";
import { safeJoinPath, safeWorkspacePath } from "../utils/SafePath.js";

export type ArchiveEntryReference = {
    id: Snowflake;
    code: string;
    path: string;
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
        this.folderPath = safeWorkspacePath(folderPath);
    }

    public getData(): ArchiveChannelData {
        return this.data;
    }

    public getFolderPath(): string {
        return this.folderPath;
    }

    public getDataPath(): string {
        return safeJoinPath(this.folderPath, 'data.json');
    }

    public async savePrivate(): Promise<void> {
        const dataPath = this.getDataPath();

        const dataCleaned: ArchiveChannelData = {
            id: this.data.id,
            name: this.data.name,
            code: this.data.code,
            category: this.data.category,
            description: this.data.description,
            currentCodeId: this.data.currentCodeId,
            entries: this.data.entries.map(entry => ({
                id: entry.id,
                code: entry.code,
                path: entry.path
            }))
        };

        return fs.writeFile(dataPath, JSON.stringify(dataCleaned, null, 2), 'utf-8');
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
            category: reference.category,
            description: reference.description,
            currentCodeId: 0,
            entries: []
        }
        const channel = new ArchiveChannel(data, channelPath);
        return channel;
    }

    public static async fromFolder(folder: string): Promise<ArchiveChannel> {
        const safeFolder = safeWorkspacePath(folder);
        const dataPath = safeJoinPath(safeFolder, 'data.json');
        const data: ArchiveChannelData = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
        const entry = new ArchiveChannel(data, safeFolder);
        return entry;
    }

}
