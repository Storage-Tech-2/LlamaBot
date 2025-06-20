export enum AuthorType {
    DiscordInGuild = "discord-in-guild",
    DiscordExternal = "discord-external",
    DiscordDeleted = "discord-deleted",
    Unknown = "unknown",
}

export type Author = {
    type: AuthorType,
    id?: string, // Discord user ID or other identifier
    username?: string, // Username
    displayName?: string, // Display name if different from username
    iconURL?: string, // URL to the user's avatar or icon
}