import { Client, Guild, Snowflake } from "discord.js";

export const SYSADMIN_ROLE_NAME = "LlamaBot SysAdmin";

export function isValidSnowflake(input: string): input is Snowflake {
    return /^\d{17,20}$/.test(input);
}

export function getConnectedGuild(client: Client, guildId: Snowflake): Guild | null {
    return client.guilds.cache.get(guildId) ?? null;
}

export function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
