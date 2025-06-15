export enum AuthorType {
    Discord = "discord",
    Unknown = "unknown",
}

export type Author = {
    type: AuthorType,
    id?: string, // Discord user ID or other identifier
    name?: string, // Username or display name
}