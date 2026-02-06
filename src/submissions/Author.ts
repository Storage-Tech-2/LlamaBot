import { Snowflake } from "discord.js"

export enum AuthorType {
    DiscordInGuild = "discord-in-guild",
    DiscordLeftGuild = "discord-left-guild",
    DiscordExternal = "discord-external",
    DiscordDeleted = "discord-deleted",
    Unknown = "unknown",
}

export type BaseAuthor = {
    type: AuthorType,
    username: string, // Username

    reason?: string, // Optional reason for the author
    dontDisplay?: boolean // If true, this author will not be displayed in the by line
    url?: string, // URL to the author's profile or relevant page
}

export type DiscordWithNameAuthor = BaseAuthor & {
    type: AuthorType.DiscordInGuild | AuthorType.DiscordLeftGuild,
    id: Snowflake, // Discord user ID
    displayName: string, // Display name if different from username
    iconURL: string, // URL to the user's avatar
}

export type DiscordExternalAuthor = BaseAuthor & {
    type: AuthorType.DiscordExternal,
    id: Snowflake, // Discord user ID
    iconURL: string, // URL to the user's avatar
}

export type DiscordDeletedAuthor = BaseAuthor & {
    type: AuthorType.DiscordDeleted,
    id: Snowflake, // Discord user ID
    displayName?: string, // Display name if it used to be known
}

export type UnknownAuthor = BaseAuthor & {
    type: AuthorType.Unknown,
}

export type AllAuthorPropertiesAccessor = BaseAuthor & {
    id?: Snowflake, // Discord user ID
    username: string, // Username
    displayName?: string, // Display name if different from username
    iconURL?: string, // URL to the user's avatar
}

export type DiscordAuthor = DiscordWithNameAuthor | DiscordExternalAuthor | DiscordDeletedAuthor;
export type Author = DiscordAuthor | UnknownAuthor;