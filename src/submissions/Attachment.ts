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

    // For wdl files
    wdl?: {
        version?: string, // Minecraft version
        error?: string, // Error message if any
    },

    // For youtube links
    youtube?: {
        title: string, // Video title
        author_name: string, // Author name
        author_url: string, // Author URL
        thumbnail_url: string, // Thumbnail URL
        thumbnail_width: number, // Thumbnail width
        thumbnail_height: number, // Thumbnail height
        width: number, // Video width
        height: number, // Video height
    }

    canDownload: boolean, // Whether the file can be downloaded
    path?: string, // Local path if downloaded
}