import { ChannelType, Guild, Message, Snowflake } from "discord.js";
import { Bot } from "./Bot";
import { ConfigManager } from "./config/ConfigManager";
import Path from "path";
import { GuildConfigs } from "./config/GuildConfigs";
import { SubmissionsManager } from "./submissions/SubmissionsManager";
import { RepositoryManager } from "./archive/RepositoryManager";
import { ArchiveEntryData } from "./archive/ArchiveEntry";
import { generateCommitMessage } from "./utils/Util";

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

    private repositoryManager: RepositoryManager;

    /**
     * Creates a new GuildHolder instance.
     * @param bot The bot instance associated with this guild holder.
     * @param guild The guild this holder is managing.
     */
    constructor(bot: Bot, guild: Guild) {
        this.bot = bot;
        this.guild = guild;
        this.config = new ConfigManager(Path.join(this.getGuildFolder(), 'config.json'));
        this.submissions = new SubmissionsManager(this, Path.join(this.getGuildFolder(), 'submissions'));
        this.repositoryManager = new RepositoryManager(this, Path.join(this.getGuildFolder(), 'archive'));
        this.config.loadConfig().then(async () => {
            // Set guild name and ID in the config
            this.config.setConfig(GuildConfigs.GUILD_NAME, guild.name);
            this.config.setConfig(GuildConfigs.GUILD_ID, guild.id);

            try {
                await this.repositoryManager.init()
            } catch (e) {
                console.error('Error initializing repository manager:', e);
            }
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
        return Path.join(__dirname, '..', 'config', this.getGuildId());
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
        await this.submissions.saveSubmissions();
        await this.repositoryManager.save();
    }

    public getGuild(): Guild {
        return this.guild;
    }

    public getBot(): Bot {
        return this.bot;
    }

    public getConfigManager(): ConfigManager {
        return this.config;
    }

    public getSubmissionsManager(): SubmissionsManager {
        return this.submissions;
    }

    public getRepositoryManager(): RepositoryManager {
        return this.repositoryManager;
    }




    public async logUpdate(oldEntryData: ArchiveEntryData | undefined, newEntryData: ArchiveEntryData) {

        const logChannelId = this.getConfigManager().getConfig(GuildConfigs.LOGS_CHANNEL_ID);
        if (!logChannelId) {
            console.warn('No log channel configured, skipping log message');
            return;
        }

        const logChannel = await this.getGuild().channels.fetch(logChannelId);
        if (!logChannel || logChannel.type !== ChannelType.GuildText) {
            console.warn('Log channel not found or not a text channel, skipping log message');
            return;
        }

        const forumChannel = await this.getGuild().channels.fetch(newEntryData.post?.threadId || '');
        if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
            console.warn('Forum channel not found or not a forum channel, skipping log message');
            return;
        }

        if (!oldEntryData) {
            await logChannel.send({
                content: `Added ${newEntryData.post?.threadURL} to ${forumChannel.url}`
            });
        } else {
            const message = generateCommitMessage(oldEntryData, newEntryData);
            if (message !== 'No changes') {
                await logChannel.send({
                    content: `${newEntryData.post?.threadURL} ${message}`
                });
            }
        }
    }
}