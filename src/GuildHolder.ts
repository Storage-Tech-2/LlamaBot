import { AnyThreadChannel, ChannelType, EmbedBuilder, ForumChannel, Guild, Message, MessageFlags, Snowflake } from "discord.js";
import { Bot } from "./Bot.js";
import { ConfigManager } from "./config/ConfigManager.js";
import Path from "path";
import { GuildConfigs } from "./config/GuildConfigs.js";
import { SubmissionsManager } from "./submissions/SubmissionsManager.js";
import { RepositoryManager } from "./archive/RepositoryManager.js";
import { ArchiveEntryData } from "./archive/ArchiveEntry.js";
import { escapeDiscordString, getAuthorsString, getChanges, truncateStringWithEllipsis } from "./utils/Util.js";
import { UserManager } from "./support/UserManager.js";
import { UserData } from "./support/UserData.js";
import { SubmissionConfigs } from "./submissions/SubmissionConfigs.js";
import { SubmissionStatus } from "./submissions/SubmissionStatus.js";
import fs from "fs/promises";

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

    private cachedChannelIds: Snowflake[] = [];

    private repositoryManager: RepositoryManager;
    private userManager: UserManager;

    private lastDayLoop: number = 0;

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
        this.userManager = new UserManager(Path.join(this.getGuildFolder(), 'users'));
        this.config.loadConfig().then(async () => {
            // Set guild name and ID in the config
            this.config.setConfig(GuildConfigs.GUILD_NAME, guild.name);
            this.config.setConfig(GuildConfigs.GUILD_ID, guild.id);

            try {
                await this.repositoryManager.init()
            } catch (e) {
                console.error('Error initializing repository manager:', e);
            }

            await this.updatePostChannelsCache();
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
        return Path.join(process.cwd(), 'config', this.getGuildId());
    }

    public getSubmissionsChannelId(): Snowflake {
        return this.config.getConfig(GuildConfigs.SUBMISSION_CHANNEL_ID) as Snowflake;
    }

    public async getPostChannels(): Promise<ForumChannel[]> {
        const categories = this.config.getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS);
        const channels: ForumChannel[] = [];
        const allChannels = await this.guild.channels.fetch();
        for (const channel of allChannels.values()) {
            if (channel && channel.type === ChannelType.GuildForum && categories.includes(channel.parentId as Snowflake)) {
                channels.push(channel as ForumChannel);
            }
        }
        return channels;
    }

    public async updatePostChannelsCache() {
        const channels = await this.getPostChannels();
        this.cachedChannelIds = channels.map(channel => channel.id);
    }

    /**
     * Handles a message received in the guild.
     */
    public async handleMessage(message: Message) {
        if (message.reference) {
            // Check if message contains "thanks" or "thank you"
            // /\b(thanks|thank you|thank u)[!\.]?\b/i
            // don't if theres a no before it
            const words = message.content.split(/\s+/).map(word => word.toLowerCase().trim().replace(/[^a-z0-9]/gi, ''));
            const thankIndex = words.findIndex(word => word === 'thanks' || word === 'thank' || word === 'thankyou' || word === 'thanku');
            if (thankIndex !== -1 && (thankIndex === 0 || words[thankIndex - 1] !== 'no')) {
                this.handleThanksMessage(message).catch(e => {
                    console.error('Error handling thanks message:', e);
                });
            }
        }

        // Handle submissions
        if (message.channel.isThread() && message.channel.parentId === this.getSubmissionsChannelId()) {
            this.handleSubmissionMessage(message).catch(e => {
                console.error('Error handling submission message:', e);
            });
        }

        // Handle message inside archived post
        if (message.channel.isThread() && message.channel.parentId && this.cachedChannelIds.includes(message.channel.parentId)) {
            this.getRepositoryManager().handlePostOrUpdateMessage(message).catch(e => {
                console.error('Error handling post message:', e);
            });
        }
    }

    public async handleMessageUpdate(_oldMessage: Message, newMessage: Message) {
        // Handle message inside archived post
        if (newMessage.channel.isThread() && newMessage.channel.parentId && this.cachedChannelIds.includes(newMessage.channel.parentId)) {
            this.getRepositoryManager().handlePostOrUpdateMessage(newMessage).catch(e => {
                console.error('Error handling post message:', e);
            });
        }
    }


    /**
     * Handles a message deletion in the guild.
     */
    public async handleMessageDelete(message: Message) {
        // Handle message inside archived post
        if (message.channel.isThread() && message.channel.parentId && this.cachedChannelIds.includes(message.channel.parentId)) {
            this.getRepositoryManager().handlePostMessageDelete(message).catch(e => {
                console.error('Error handling post message:', e);
            });
        }
    }

    /**
     * Handles a thread deletion in the guild.
     */
    public async handleThreadDelete(thread: AnyThreadChannel) {
        // Handle message inside archived post
        if (thread.parentId && this.cachedChannelIds.includes(thread.parentId)) {
            this.getRepositoryManager().handlePostThreadDelete(thread).catch(e => {
                console.error('Error handling post thread deletion:', e);
            });
        }

        // Handle submission thread deletion
        if (thread.parentId === this.getSubmissionsChannelId()) {
            const submissionId = thread.id;
            try {
                const submission = await this.submissions.getSubmission(submissionId);
                if (submission && submission.canJunk() && submission.getConfigManager().getConfig(SubmissionConfigs.STATUS) !== SubmissionStatus.ACCEPTED) {
                    const folder = submission.getFolderPath();
                    // Delete the submission folder recursively
                    await fs.rm(folder, { recursive: true, force: true });
                    // Remove the submission from the submissions manager
                    await this.submissions.removeSubmission(submissionId);
                }
            } catch (e) {
                console.error('Error handling submission thread deletion:', e);
            }
        }
    }

    public async handleThreadUpdate(oldThread: AnyThreadChannel, newThread: AnyThreadChannel) {
        if (newThread.parentId && this.cachedChannelIds.includes(newThread.parentId)) {
            this.getRepositoryManager().handlePostThreadUpdate(oldThread, newThread).catch(e => {
                console.error('Error handling post thread update:', e);
            });
        }
    }

    public async handleSubmissionMessage(message: Message) {
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

    public async handleThanksMessage(message: Message) {
        // Check if it's a reply to another message
        if (!message.reference || !message.reference.messageId) {
            console.warn('Message is not a reply, skipping thanks handling');
            return;
        }

        // Fetch the original message being replied to
        const originalMessage = await message.channel.messages.fetch(message.reference.messageId);
        if (!originalMessage) {
            console.warn('Original message not found, skipping thanks handling');
            return;
        }

        // Get author of the original message
        const thanksSenderID = message.author.id;
        const thanksRecieverID = originalMessage.author.id;

        // Check if the sender and receiver are the same
        if (thanksSenderID === thanksRecieverID) {
                 const embed = new EmbedBuilder()
                .setColor(0x00FF00) // Green color for thank you message
                .setTitle(`Good Job!`)
                .setDescription(`Self-appreciation is great, but we won't give you a point for it. :heart:`)
                .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
            await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
            return;
        }

        // Check if the receiver is a bot
        if (originalMessage.author.bot) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00) // Green color for thank you message
                .setTitle(`Thank you too!`)
                .setDescription(`We appreciate your gratitude, but as a large language model, I am not a person so I cannot give you points.`)
                .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
            await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
            return;
        }

        // get user data for reciever
        let userData = await this.userManager.getUserData(thanksRecieverID);
        if (!userData) {
            userData = {
                id: thanksRecieverID,
                username: originalMessage.author.username,
                thankedCountTotal: 0,
                thankedBuffer: [],
            };
            await this.userManager.saveUserData(userData);
        }

        // Check if the sender has already thanked the receiver in the last 24 hours
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000; //
        if (userData.thankedBuffer.some(thank => thank.thankedBy === thanksSenderID && now - thank.timestamp < oneDay)) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00) // Green color for thank you message
                .setTitle(`Point Already Given!`)
                .setDescription(`You've already thanked <@${thanksRecieverID}> in the last 24 hours. Thank you anyway for being great!`)
                .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
            await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });

            return; // Already thanked in the last 24 hours
        }

        // Add the thank you to the buffer
        userData.thankedBuffer.push({
            thankedBy: thanksSenderID,
            timestamp: now,
            channelId: message.channel.id,
            messageId: message.id,
        });

        // Increment the thanked count
        userData.thankedCountTotal++;
        await this.userManager.saveUserData(userData);

        // Send a thank you message in the channel
        const embed = new EmbedBuilder()
            .setColor(0x00FF00) // Green color for thank you message
            .setTitle(`Point Received!`)
            .setDescription(`<@${thanksSenderID}> gave a point to <@${thanksRecieverID}>!`)
            .addFields(
                { name: 'Total points', value: `${userData.thankedCountTotal}`, inline: true },
                { name: 'In the past month', value: `${userData.thankedBuffer.length}`, inline: true },
            )
            .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
        await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
        await this.checkHelper(userData);
    }


    /**
     * Called every second to perform periodic tasks.
     */
    public async loop() {
        await this.config.saveConfig();
        await this.submissions.purgeOldSubmissions();
        await this.submissions.saveSubmissions();
        await this.repositoryManager.save();

        const now = Date.now();
        if (now - this.lastDayLoop >= 24 * 60 * 60 * 1000) { // Every 24 hours
            this.lastDayLoop = now;
            await this.purgeThanksBuffer();
            await this.getRepositoryManager().updateEntryAuthorsTask().catch(e => {
                console.error('Error updating entry authors:', e);
            });
        }
    }

    public async purgeThanksBuffer() {
        const users = await this.userManager.getAllUserIDs();
        for (const userId of users) {
            const userData = await this.userManager.getUserData(userId);
            if (!userData) continue;

            // Purge buffer entries older than 30 days
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            userData.thankedBuffer = userData.thankedBuffer.filter(thank => thank.timestamp >= thirtyDaysAgo);

            // Save updated user data
            await this.userManager.saveUserData(userData);

            await this.checkHelper(userData);
        }

    }

    public async checkHelper(userData: UserData) {
        const shouldHaveHelperRole = userData.thankedBuffer.length >= this.getConfigManager().getConfig(GuildConfigs.HELPER_ROLE_THRESHOLD);
        const guild = this.getGuild();
        const helperRoleId = this.getConfigManager().getConfig(GuildConfigs.HELPER_ROLE_ID) as Snowflake | undefined;
        if (!helperRoleId) {
            return;
        }

        const helperRole = guild.roles.cache.get(helperRoleId);
        if (!helperRole) {
            console.warn(`Helper role with ID ${helperRoleId} not found in guild ${guild.name}`);
            return;
        }

        const member = await guild.members.fetch(userData.id).catch(() => null);
        if (!member) {
            console.warn(`Member with ID ${userData.id} not found in guild ${guild.name}`);
            return;
        }

        const hasHelperRole = member.roles.cache.has(helperRoleId);
        if (shouldHaveHelperRole && !hasHelperRole) {
            await member.roles.add(helperRole);
        }
        else if (!shouldHaveHelperRole && hasHelperRole) {
            await member.roles.remove(helperRole);
        }

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
        if (!logChannel || !logChannel.isTextBased()) {
            console.warn('Log channel not found or not a text channel, skipping log message');
            return;
        }

        const forumChannel = await this.getGuild().channels.fetch(newEntryData.post?.forumId || '');
        if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
            console.warn('Forum channel not found or not a forum channel, skipping log message');
            return;
        }

        // const submissionChannel = await this.getGuild().channels.fetch(this.getSubmissionsChannelId());
        // if (!submissionChannel || submissionChannel.type !== ChannelType.GuildForum) {
        //     console.warn('Submission channel not found or not a forum channel, skipping log message');
        //     return;
        // }

        const submissionThread = await this.getGuild().channels.fetch(newEntryData.id);
        if (!submissionThread) {
            console.warn('Submission thread not found, skipping log message');
            return;
        }


        const embed = new EmbedBuilder();
        if (!oldEntryData) {
            embed.setTitle(`Added ${newEntryData.code} to ${forumChannel.name}`)
            embed.setDescription(`**Name:** ${newEntryData.name}\n[Submission Thread](${submissionThread.url})`);
            embed.setURL(newEntryData.post?.threadURL || '');
            embed.setColor(0x00FF00); // Green for new entry
        } else {
            const changes = getChanges(oldEntryData, newEntryData);
            if (changes.code) {
                embed.setTitle(`Moved ${oldEntryData.code} to ${forumChannel.name}`);
            } else if (changes.name) {
                embed.setTitle(`Updated name for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.description) {
                embed.setTitle(`Updated description for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.tags) {
                embed.setTitle(`Updated tags for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.authors) {
                embed.setTitle(`Updated authors for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.endorsers) {
                embed.setTitle(`Updated endorsers for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.features) {
                embed.setTitle(`Updated features for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.considerations) {
                embed.setTitle(`Updated considerations for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.notes) {
                embed.setTitle(`Updated notes for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.images) {
                embed.setTitle(`Updated images for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.attachments) {
                embed.setTitle(`Updated attachments for ${newEntryData.code} in ${forumChannel.name}`);
            } else {
                return; // No significant changes to log
            }

            embed.setDescription(`**Name:** ${newEntryData.name}\n[Submission Thread](${submissionThread.url})`);
            embed.setURL(newEntryData.post?.threadURL || '');

            const fields = [];
            if (changes.code) fields.push({ name: 'Code', value: `*${oldEntryData.code}* → *${newEntryData.code}*` });
            if (changes.name) fields.push({ name: 'Name', value: `*${oldEntryData.name}* → *${newEntryData.name}*` });
            if (changes.authors) fields.push({ name: 'Authors', value: `*${getAuthorsString(oldEntryData.authors)}* → *${getAuthorsString(newEntryData.authors)}*` });
            if (changes.endorsers) fields.push({ name: 'Endorsers', value: `*${getAuthorsString(oldEntryData.endorsers)}* → *${getAuthorsString(newEntryData.endorsers)}*` });
            if (changes.tags) fields.push({ name: 'Tags', value: `*${oldEntryData.tags.map(t => t.name).join(', ')}* → *${newEntryData.tags.map(t => t.name).join(', ')}*` });
            if (changes.description) fields.push({ name: 'Description', value: `*${truncateStringWithEllipsis(oldEntryData.description, 100)}* → *${truncateStringWithEllipsis(newEntryData.description, 500)}*` });
            if (changes.features) fields.push({ name: 'Features', value: `*${oldEntryData.features.length} features* → *${newEntryData.features.length} features*` });
            if (changes.considerations) fields.push({ name: 'Considerations', value: `*${oldEntryData.considerations.length} considerations* → *${newEntryData.considerations.length} considerations*` });
            if (changes.notes) fields.push({ name: 'Notes', value: `*${oldEntryData.notes.length} characters* → *${newEntryData.notes.length} characters*` });
            if (changes.images) fields.push({ name: 'Images', value: `*${oldEntryData.images.length} images* → *${newEntryData.images.length} images*` });
            if (changes.attachments) fields.push({ name: 'Attachments', value: `*${oldEntryData.attachments.map(o=>escapeDiscordString(o.name)).join(", ")} attachments* → *${newEntryData.attachments.map(o=>escapeDiscordString(o.name)).join(", ")} attachments*` });
            embed.addFields(fields);
            embed.setColor(0xFFFF00); // Yellow for update
        }

        embed.setTimestamp();

        await logChannel.send({
            embeds: [embed],
        });
    }


    public async logRetraction(oldEntryData: ArchiveEntryData, reason: string) {
        const logChannelId = this.getConfigManager().getConfig(GuildConfigs.LOGS_CHANNEL_ID);
        if (!logChannelId) {
            console.warn('No log channel configured, skipping log message');
            return;
        }

        const logChannel = await this.getGuild().channels.fetch(logChannelId);
        if (!logChannel || !logChannel.isTextBased()) {
            console.warn('Log channel not found or not a text channel, skipping log message');
            return;
        }

        // const submissionChannel = await this.getGuild().channels.fetch(this.getSubmissionsChannelId());
        // if (!submissionChannel || submissionChannel.type !== ChannelType.GuildForum) {
        //     console.warn('Submission channel not found or not a forum channel, skipping log message');
        //     return;
        // }

        const submissionThread = await this.getGuild().channels.fetch(oldEntryData.id);
        if (!submissionThread) {
            console.warn('Submission thread not found, skipping log message');
            return;
        }


        const forumChannel = await this.getGuild().channels.fetch(oldEntryData.post?.forumId || '');
        if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
            console.warn('Forum channel not found or not a forum channel, skipping log message');
            return;
        }

        const embed = new EmbedBuilder();

        embed.setTitle(`Retracted ${oldEntryData.code} from ${forumChannel.name}`)
        embed.setURL(submissionThread.url);
        embed.setDescription(`**Name:** ${oldEntryData.name}\n[Submission Thread](${submissionThread.url})`)
            .setURL(submissionThread.url)
            .setColor(0xFF0000) // Red for retraction
            .addFields(
                { name: 'Reason', value: reason },
            );
        embed.setTimestamp();

        await logChannel.send({
            embeds: [embed],
        });
    }

    public getUserManager(): UserManager {
        return this.userManager;
    }
}