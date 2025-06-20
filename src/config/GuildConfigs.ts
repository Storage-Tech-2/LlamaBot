import { Snowflake } from "discord.js";
import { Config } from "./ConfigManager.js";

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
     * Helper role threshold
     */
    HELPER_ROLE_THRESHOLD: new Config<number>("helperRoleThreshold", 5),
}