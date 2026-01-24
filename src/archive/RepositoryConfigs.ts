import { JSONSchema7 } from "json-schema";
import { Config } from "../config/ConfigManager.js";
import { StyleInfo } from "../utils/MarkdownUtils.js";
import { Emoji, GuildForumTag } from "discord.js";

export type ArchiveChannelReference = {
    id: string;
    name: string;
    code: string;
    embedding?: string;
    category: string;
    description: string;
    path: string;
    position: number;
}


export const RepositoryConfigs = {
    /**
     * Channel categories for the archive.
     */
    ARCHIVE_CHANNELS: new Config<ArchiveChannelReference[]>("archiveChannels", []),

    /**
     * Schema for the posts
     */
    POST_SCHEMA: new Config<JSONSchema7>("postSchema", {
        "title": "Submission",
        "type": "object",
        "properties": {
            "description": {
                "type": "string",
                "description": "A description of the device."
            },
            "features": {
                "type": "array",
                "items": {
                    "type": "string"
                },
                "description": "A list of features of the device."
            },
            "considerations": {
                "type": "array",
                "items": {
                    "type": "string"
                },
                "description": "Optional list of considerations/downsides of the device."
            },
            "notes": {
                "type": "string",
                "description": "Optional notes about the device."
            }
        },
        "required": [
            "name",
            "description",
            "features"
        ]
    }),

    POST_STYLE: new Config<Record<string, StyleInfo>>("postStyle", {}),

    GLOBAL_TAGS: new Config<GuildForumTag[]>("globalTags", [
        {
            name: 'Untested',
            emoji: { name: '⁉️' }
        },
        {
            name: 'Broken',
            emoji: { name: '💔' }
        },
        {
            name: 'Tested & Functional',
            emoji: { name: '✅' }
        },
        {
            name: 'Recommended',
            emoji: { name: '⭐' },
            moderated: true
        }
    ] as GuildForumTag[]),

    DEFAULT_REACTION: new Config<Emoji>("defaultReaction", {
        name: '👍'
    } as Emoji),

}