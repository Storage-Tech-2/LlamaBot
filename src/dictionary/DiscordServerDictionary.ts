import { Snowflake } from "discord.js"
import fs from "fs/promises";
import Path from "path";

export type DiscordServerEntry = {
    id: Snowflake,
    name: string,
    joinURL: string
}

export class DiscordServersDictionary {
    private cache: Promise<DiscordServerEntry[]> | null = null;
    private cacheTimeout?: NodeJS.Timeout;

    constructor(private folderPath: string) {

    }

    async getCachedServers(): Promise<DiscordServerEntry[]> {
        clearTimeout(this.cacheTimeout);
        this.cacheTimeout = setTimeout(() => {
            this.cache = null;
        }, 60 * 1000);

        if (this.cache) {
            return this.cache;
        }
        this.cache = this.getServers();

        return this.cache;
    }

    async getServers(): Promise<DiscordServerEntry[]> {
        const entryPath = Path.join(this.folderPath, `servers.json`);
        return JSON.parse(await fs.readFile(entryPath, 'utf-8').catch(() => '[]')) as DiscordServerEntry[];
    }

    async getByID(id: Snowflake): Promise<DiscordServerEntry | undefined> {
        const servers = await this.getServers();
        return servers.find(s => s.id === id)
    }

    async addOrEditServer(id: Snowflake, name: string, joinURL: string) {
        const servers = await this.getServers();
        const existing = servers.find(s => s.id === id);
        if (existing) {
            existing.name = name;
            existing.joinURL = joinURL;
        } else {
            servers.push({
                id,
                name,
                joinURL
            });
        }
        const entryPath = Path.join(this.folderPath, `servers.json`);
        await fs.writeFile(entryPath, JSON.stringify(servers, null, 2), 'utf-8');
        this.cache = null;
    }

    async removeServer(id: Snowflake): Promise<boolean> {
        const servers = await this.getServers();
        const index = servers.findIndex(s => s.id === id);
        if (index === -1) {
            return false;
        }
        servers.splice(index, 1);
        const entryPath = Path.join(this.folderPath, `servers.json`);
        await fs.writeFile(entryPath, JSON.stringify(servers, null, 2), 'utf-8');
        this.cache = null;
        return true;
    }

}