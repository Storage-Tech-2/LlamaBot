import { Guild, Message, MessageReferenceType, MessageType, Snowflake } from "discord.js";
import { Bot } from "./Bot";
import { ConfigManager } from "./config/ConfigManager";
import Path from "path";
import { GuildConfigs } from "./config/GuildConfigs";
import { SubmissionsManager } from "./submissions/SubmissionsManager";

/**
 * GuildHolder is a class that manages guild-related data.
 */
export class GuildHolder {
    /**
     * The bot instance associated with this guild holder.
     */
    private bot: Bot;

    /**
     * The guild this holder is managing.
     */
    private guild: Guild;

    /**
     * The configuration for the guild.
     */
    private config: ConfigManager;

    /**
     * The submissions for this guild.
     */
    private submissions: SubmissionsManager;

    /**
     * Creates a new GuildHolder instance.
     * @param bot The bot instance associated with this guild holder.
     * @param guild The guild this holder is managing.
     */
    constructor(bot: Bot, guild: Guild) {
        this.bot = bot;
        this.guild = guild;
        this.config = new ConfigManager(this.getGuildFolder());
        this.submissions = new SubmissionsManager(this, Path.join(this.getGuildFolder(), 'submissions'));
        this.config.loadConfig().then(() => {
            // Set guild name and ID in the config
            this.config.setConfig(GuildConfigs.GUILD_NAME, guild.name);
            this.config.setConfig(GuildConfigs.GUILD_ID, guild.id);
            console.log(`GuildHolder initialized for guild: ${guild.name} (${guild.id})`);
        });
    }

    /**
     * Gets the guild ID for this guild holder.
     * @returns The Snowflake ID of the guild.
     */
    public getGuildId(): Snowflake {
        return this.guild.id;
    }

    /**
     * Gets the guild folder path for this guild holder.
     * @returns The path to the guild's configuration folder.
     */
    public getGuildFolder(): string {
        return Path.join(__dirname, '..', 'config', this.getGuildId(), 'config.json');
    }

    public getSubmissionsChannelId(): Snowflake {
        return this.config.getConfig(GuildConfigs.SUBMISSION_CHANNEL_ID) as Snowflake;
    }

    /**
     * Handles a message received in the guild.
     */
    public async handleMessage(message: Message) {
        if (message.channel.isThread() && message.channel.parentId === this.getSubmissionsChannelId()) {
            const submissionId = message.channel.id
            let submission = await this.submissions.getSubmission(submissionId)
            if (!submission) {
                submission = await this.submissions.makeSubmission(submissionId)
                submission.init().catch(e => {
                    console.error('Error initializing submission:', e)
                })
            } else {
                await submission.handleMessage(message)
            }
        }
    }

    /**
     * Called every second to perform periodic tasks.
     */
    public async loop() {
        await this.config.saveConfig();
        await this.submissions.purgeOldSubmissions();
    }
}