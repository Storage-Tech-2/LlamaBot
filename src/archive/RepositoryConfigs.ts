import { JSONSchema7 } from "json-schema";
import { Config } from "../config/ConfigManager.js";
import { StyleInfo } from "../utils/MarkdownUtils.js";
import { Emoji } from "discord.js";

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

export type GlobalTag = {
    name: string;
    emoji?: string;
    colorWeb?: string;
    colorMod?: number;
    moderated?: boolean;
}


const DEFAULT_SCHEMA: JSONSchema7 = {
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
            "minItems": 1,
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
        "description",
        "features"
    ]
};

export const DEFAULT_GLOBAL_TAGS: GlobalTag[] = [
    {
        name: 'Untested',
        emoji: '⁉️',
        colorWeb: '#fcd34d',
    },
    {
        name: 'Broken',
        emoji: '💔',
        colorWeb: '#ff6969',
    },
    {
        name: 'Tested & Functional',
        emoji: '✅',
        colorWeb: '#34d399',
    },
    {
        name: 'Recommended',
        emoji: '⭐',
        colorWeb: '#60a5fa',
        moderated: true
    }
];

export const RepositoryConfigs = {
    /**
     * Old channel categories for the archive.
     */
    ARCHIVE_CHANNELS_LEGACY: new Config<ArchiveChannelReference[]>("archiveChannels", []),

    /**
     * Schema for the posts
     */
    POST_SCHEMA: new Config<JSONSchema7>("postSchema", DEFAULT_SCHEMA),

    POST_STYLE: new Config<Record<string, StyleInfo>>("postStyle", {}),

    GLOBAL_TAGS: new Config<GlobalTag[]>("globalTags", DEFAULT_GLOBAL_TAGS),

    DEFAULT_REACTION: new Config<Emoji>("defaultReaction", {
        name: '👍'
    } as Emoji),

}