import fs from "fs/promises";
import path from "path";
import { Snowflake } from "discord.js";
import { safeWorkspacePath } from "../utils/SafePath.js";

type GuildWhitelistData = {
    guildIds: Snowflake[];
};

export class GuildWhitelistManager {
    private guildIds: Set<Snowflake> = new Set();

    constructor(private readonly filePath: string) {
        this.filePath = safeWorkspacePath(filePath);
    }

    public async load(): Promise<void> {
        try {
            const raw = await fs.readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as GuildWhitelistData | Snowflake[];
            const ids = Array.isArray(parsed) ? parsed : parsed.guildIds;
            this.guildIds = new Set((ids ?? []).filter(id => this.isValidSnowflake(id)));
        } catch {
            this.guildIds = new Set();
        }
    }

    public getGuildIds(): Snowflake[] {
        return Array.from(this.guildIds.values()).sort();
    }

    public isEnforced(): boolean {
        return this.guildIds.size > 0;
    }

    public isGuildAllowed(guildId: Snowflake): boolean {
        if (!this.isEnforced()) {
            return true;
        }
        return this.guildIds.has(guildId);
    }

    public async addGuild(guildId: Snowflake): Promise<boolean> {
        if (this.guildIds.has(guildId)) {
            return false;
        }
        this.guildIds.add(guildId);
        await this.save();
        return true;
    }

    public async removeGuild(guildId: Snowflake): Promise<boolean> {
        if (!this.guildIds.delete(guildId)) {
            return false;
        }
        await this.save();
        return true;
    }

    public async clear(): Promise<boolean> {
        if (this.guildIds.size === 0) {
            return false;
        }
        this.guildIds.clear();
        await this.save();
        return true;
    }

    private async save(): Promise<void> {
        const dir = path.dirname(this.filePath);
        await fs.mkdir(dir, { recursive: true });
        const data: GuildWhitelistData = {
            guildIds: this.getGuildIds(),
        };
        await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    }

    private isValidSnowflake(value: unknown): value is Snowflake {
        return typeof value === "string" && /^\d{17,20}$/.test(value);
    }
}
