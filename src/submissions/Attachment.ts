import { Snowflake } from "discord.js";
import { Author } from "./Author.js";
import { WorldMetadata } from "../utils/WDLUtils.js";


export enum AttachmentSource {
    DirectUpload = "DirectUpload",
    MessageAttachment = "MessageAttachment",
    URLInMessage = "URLInMessage",
}

export type BaseAttachment = {
    id: Snowflake,
    name: string,
    url: string,
    downloadUrl?: string, // URL to download the file if different
    description: string,
    timestamp: number, // Timestamp when the attachment was added
    author: Author,
    source: AttachmentSource,
    contentType: string,
    path?: string, // Local path if downloaded
    size?: number, // Size in bytes if known
    hash?: string, // File hash for optimizing downloads
    unoptimizedSize?: number, // Original size in bytes if optimized
    canDownload: boolean, // Whether the file can be downloaded
}

export type Attachment = BaseAttachment & {
    image?: { // For images
        width: number,
        height: number,
    },

    // For litematics
    litematic?: {
        version?: string,
        size?: string,
        error?: string,
    },

    // For WorldEdit schematics
    schematic?: {
        version?: string,
        size?: string,
        error?: string,
    },

    // For wdl files, legacy
    wdl?: {
        version?: string, // Minecraft version
        error?: string, // Error message if any
        optimized?: boolean, // Whether the wdl was optimized
    },

    wdls?: WorldMetadata[],

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
}

export type AttachmentAskDescriptionData = {
    areImages: boolean;
    toAsk: Attachment[];
    toSet: Attachment[];
}