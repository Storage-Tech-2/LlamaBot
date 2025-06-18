import { Snowflake } from "discord.js";

export type Attachment = {
    id: Snowflake,
    name: string,
    url: string,
    description: string,
    contentType: string,

    // For litematics
    litematic?: {
        version?: string,
        size?: string,
        error?: string,
    },

    path?: string, // Local path if downloaded
}