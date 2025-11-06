import { Snowflake } from "discord.js";
import { Config } from "./ConfigManager.js";
import { Author } from "../submissions/Author.js";

export const GuildConfigs = {
    /**
     * The name of the guild.
     */
    GUILD_NAME: new Config("guildName", "Unknown Guild"),

    /**
     * The ID of the guild. A snowflake.
     */
    GUILD_ID: new Config("guildId", ""),

    /**
     * The ID of the channel where submissions are sent.
     */
    SUBMISSION_CHANNEL_ID: new Config("submissionChannelId", ""),

    /**
     * The IDs of the categories where archive channels live
     */
    ARCHIVE_CATEGORY_IDS: new Config<Snowflake[]>("archiveCategoryIds", []),

    /**
     * The ID of the channel where the bot sends updates about submissions.
     */
    LOGS_CHANNEL_ID: new Config<Snowflake>("logsChannelId", ""),

    /**
     * The IDs of the roles that can endorse submissions.
     */
    ENDORSE_ROLE_IDS: new Config<Snowflake[]>("endorseRoleIds", []),

    /**
     * The IDs of the roles that can edit submissions.
     */
    EDITOR_ROLE_IDS: new Config<Snowflake[]>("editorRoleIds", []),


    /**
     * Github repository URL for the archive.
     */
    GITHUB_REPO_URL: new Config<string>("githubRepoUrl", ""),

    /**
     * Helper role
     */
    HELPER_ROLE_ID: new Config<Snowflake>("helperRoleId", ""),

    /**
     * Designer role
     */
    DESIGNER_ROLE_ID: new Config<Snowflake>("designerRoleId", ""),

    /**
     * Helper role threshold
     */
    HELPER_ROLE_THRESHOLD: new Config<number>("helperRoleThreshold", 5),

    /**
     * User blacklist
     */
    THANKS_BLACKLIST: new Config<Author[]>("thanksBlacklist", []),

    /**
     * Schema for the posts
     */
    POST_SCHEMA: new Config<any>("postSchema", {
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


    /**
     * Honeypot channel ID
     */
    HONEYPOT_CHANNEL_ID: new Config<Snowflake>("honeypotChannelId", ""),

    /**
     * Moderation log channel ID
     */
    MOD_LOG_CHANNEL_ID: new Config<Snowflake>("modLogChannelId", ""),

    /**
     * Conversational LLM enabled
     */
    CONVERSATIONAL_LLM_ENABLED: new Config<boolean>("conversationalLlmEnabled", false),

    /**
     * Website URL
     */
    WEBSITE_URL: new Config<string>("websiteUrl", ""),
}