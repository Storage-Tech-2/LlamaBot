import { Client } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { GuildWhitelistManager } from "../config/GuildWhitelistManager.js";

export type SysAdminCommandContext = {
    client: Client;
    guilds: Map<string, GuildHolder>;
    dayTaskTimestamps: Map<string, number>;
    guildWhitelistManager: GuildWhitelistManager;
};
