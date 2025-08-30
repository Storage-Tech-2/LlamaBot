import { AnyThreadChannel, ChannelType, EmbedBuilder, ForumChannel, Guild, GuildMember, Message, MessageFlags, Snowflake } from "discord.js";
import { Bot } from "./Bot.js";
import { ConfigManager } from "./config/ConfigManager.js";
import Path from "path";
import { GuildConfigs } from "./config/GuildConfigs.js";
import { SubmissionsManager } from "./submissions/SubmissionsManager.js";
import { RepositoryManager } from "./archive/RepositoryManager.js";
import { ArchiveEntryData } from "./archive/ArchiveEntry.js";
import { escapeDiscordString, getAuthorsString, getChanges, splitIntoChunks } from "./utils/Util.js";
import { UserManager } from "./support/UserManager.js";
import { UserData } from "./support/UserData.js";
import { SubmissionConfigs } from "./submissions/SubmissionConfigs.js";
import { SubmissionStatus } from "./submissions/SubmissionStatus.js";
import fs from "fs/promises";
import { countCharactersInRecord } from "./utils/MarkdownUtils.js";
import { Author, AuthorType } from "./submissions/Author.js";
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
    private ready: boolean = false;

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
            this.ready = true;
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

        // const match = message.content.match(/\b(isn'?t |not |never )?unload (?:safe|proof)\??\b/i);
        // if (match) {
        //     const isNegated = match[1] !== undefined;
        //     if (!isNegated) {
        //         // Reply with "Nothing is unload safe."
        //         await message.reply('Nothing here is unload safe. Never assume anything redstone is unload safe. Have a good day!');
        //     }
        // }

        if (message.reference && this.getConfigManager().getConfig(GuildConfigs.HELPER_ROLE_ID)) {
            // Check if message contains "thanks" or "thank you"
            // /\b(thanks|thank you|thank u)[!\.]?\b/i
            // don't if theres a no before it
            const words = message.content.split(/\s+/).map(word => word.toLowerCase().trim().replace(/[^a-z0-9]/gi, ''));
            const thankIndex = words.findIndex(word => word === 'thanks' || word === 'thank' || word === 'thankyou' || word === 'thanku' || word === 'thx' || word === 'tysm' || word === 'ty');
            if (thankIndex !== -1 && (thankIndex === 0 || words[thankIndex - 1] !== 'no')) {

                // check if reference message is from the bot itself
                let skip = false;
                if (message.reference.messageId) {
                    const referencedMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                    if (referencedMessage && referencedMessage.author.id === this.getBot().client.user?.id) {
                        skip = true;
                    }
                }
                if (!skip) {
                    this.handleThanksMessage(message).catch(e => {
                        console.error('Error handling thanks message:', e);
                    });
                    return;
                }
            }
        }

        // Handle message inside archived post
        if (message.channel.isThread() && message.channel.parentId && this.cachedChannelIds.includes(message.channel.parentId)) {
            this.getRepositoryManager().handlePostOrUpdateMessage(message).catch(e => {
                console.error('Error handling post message:', e);
            });
            return;
        }

        // Handle submissions
        if (message.channel.isThread() && message.channel.parentId === this.getSubmissionsChannelId()) {
            if (await this.handleSubmissionMessage(message).catch(e => {
                console.error('Error handling submission message:', e);
                return true;
            })) {
                return;
            }
        }

        // Handle honeypot channel
        const honeypotChannelId = this.getConfigManager().getConfig(GuildConfigs.HONEYPOT_CHANNEL_ID);
        if (honeypotChannelId && message.channel.id === honeypotChannelId) {
            // Timeout the user permanently
            const member = await this.guild.members.fetch(message.author.id).catch(() => null);
            if (member) {
                try {
                    // Check if has perms
                    if (!member.manageable) {
                        const embed = new EmbedBuilder()
                        embed.setColor(0xFF0000) // Red color for honeypot message
                        embed.setTitle(`Honeypot Triggered!`)
                        embed.setDescription(`Unfortunately, <@${message.author.id}> is immune to honeypot timeouts because I cannot manage their role.`);
                        embed.setFooter({ text: `This is a honeypot channel to catch spammers.` });
                        if (message.channel.isSendable()) {
                            await message.channel.send({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
                        }
                        return;
                    }
                    try {
                        await member.timeout(0, 'Honeypot');
                    } catch (e: any) {
                        const embed = new EmbedBuilder()
                        embed.setColor(0xFF0000) // Red color for honeypot message
                        embed.setTitle(`Honeypot Triggered!`)
                        embed.setDescription(`Unfortunately, <@${message.author.id}> is immune to honeypot because I do not have permission to timeout them.`);
                        embed.setFooter({ text: `This is a honeypot channel to catch spammers.` });
                        if (message.channel.isSendable()) {
                            await message.channel.send({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
                        }
                        return;
                    }
                    await message.delete();

                    // delete all messages sent by the user in past hour in every channel
                    let deletedMessages = 1;
                    await this.guild.channels.cache.reduce(async (acc, channel) => {
                        if (channel.isTextBased() && !channel.isThread()) {
                            const fetchedMessages = await channel.messages.fetch({ limit: 100 });
                            const userMessages = fetchedMessages.filter(m => m.author.id === message.author.id && m.createdAt > new Date(Date.now() - 60 * 60 * 1000));
                            const messagesToDelete = userMessages.map(m => m.id);
                            if (messagesToDelete.length > 0) {
                                await channel.bulkDelete(messagesToDelete, true).catch(console.error);
                            }
                            deletedMessages += messagesToDelete.length;
                        }
                        return acc;
                    }, Promise.resolve()).catch(console.error);

                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000) // Red color for honeypot message
                        .setTitle(`Honeypot Triggered!`)
                        .setDescription(`Timed out <@${message.author.id}> for sending a message in the honeypot channel and deleted ${deletedMessages} of their messages in the past hour.`)
                        .setFooter({ text: `This is a honeypot channel to catch spammers.` });
                    // send a message to the honeypot channel
                    if (message.channel.isSendable()) {
                        await message.channel.send({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
                    }
                } catch (e: any) {
                    console.error(`Failed to timeout member ${message.author.id} in guild ${this.guild.name}:`, e);
                    // try {
                    //     // Send an error message to the honeypot channel
                    //     if (message.channel.isSendable()) {
                    //         await message.channel.send(`Failed to timeout <@${message.author.id}>. Error: ${escapeDiscordString(e.message)}, stack: ${e.stack}`);
                    //     }
                    // } catch (e) {
                    //     console.error(`Failed to send error message to honeypot channel:`, e);
                    // }
                }
            } else {
                console.warn(`Member ${message.author.id} not found in guild ${this.guild.name}`);
            }
            return;
        }

        // Finally, check if llm is available;
        const isAdmin = message.member?.permissions.has('Administrator') || false;
        if (!this.bot.canConverse() || (!this.getConfigManager().getConfig(GuildConfigs.CONVERSATIONAL_LLM_ENABLED) && !isAdmin)) {
            return;
        }

        let shouldReply = false;
        // check if message is a reply to the bot
        if (message.reference && message.reference.messageId) {
            const referencedMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (referencedMessage && referencedMessage.author.id === this.getBot().client.user?.id) {
                shouldReply = true;
            }
        }

        // check if message mentions the bot
        if (message.mentions.has(this.getBot().client.user?.id || '')) {
            shouldReply = true;
        }

        if (shouldReply && (message.channel.type === ChannelType.GuildText || message.channel.type === ChannelType.PublicThread)) {
            const channel = message.channel;
            // send typing
            await channel.sendTyping().catch(() => null);
            // typing interval
            const typingInterval = setInterval(() => {
                channel.sendTyping().catch(() => null);
            }, 9000);
            const reply = await this.bot.respondToConversation(channel, message).catch(e => {
                console.error('Error responding to conversation:', e);
                return 'Sorry, I had an error trying to respond to that message.';
            });
            clearInterval(typingInterval);
            if (reply) {
                const split = splitIntoChunks(reply, 2000);
                for (let i = 0; i < split.length; i++) {
                    if (i === 0) {
                        await message.reply({ content: split[i], flags: [MessageFlags.SuppressNotifications, MessageFlags.SuppressEmbeds] }).catch(console.error);
                    } else {
                        await channel.send({ content: reply, flags: [MessageFlags.SuppressNotifications, MessageFlags.SuppressEmbeds] }).catch(console.error);
                    }
                }
            }
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
        const channelId = message.channelId;
        const channel = message.channel || await this.guild.channels.fetch(channelId).catch(() => null);

        if (channel.isThread() && channel.parentId && this.cachedChannelIds.includes(channel.parentId)) {
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
        } else if (newThread.parentId === this.getSubmissionsChannelId()) {
            const submissionId = newThread.id;
            try {
                const submission = await this.submissions.getSubmission(submissionId);
                if (submission) {
                    await submission.handleThreadUpdate(oldThread, newThread);
                }
            } catch (e) {
                console.error('Error handling submission thread deletion:', e);
            }
        }
    }

    public async handleSubmissionMessage(message: Message): Promise<boolean> {
        const submissionId = message.channel.id
        let submission = await this.submissions.getSubmission(submissionId)
        if (!submission) {
            submission = await this.submissions.makeSubmission(submissionId)
            submission.init().catch(e => {
                console.error('Error initializing submission:', e)
            })
            return false;
        } else {
            return await submission.handleMessage(message)
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

        // Check if in blacklist
        const blacklistedUsers = this.getConfigManager().getConfig(GuildConfigs.THANKS_BLACKLIST);
        if (blacklistedUsers.some(user => user.id === thanksSenderID)) {
            return;
        }

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
            // If the bot is the Storage Tech Bot itself
            if (originalMessage.author.id === this.getBot().client.user?.id) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00) // Green color for thank you message
                    .setTitle(`Thank you too!`)
                    .setDescription(`We appreciate your gratitude, but as a large language model, I am not a person so I cannot give you points.`)
                    .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
                await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
            }
            return;
        }

        // get user data for reciever
        let userData = await this.userManager.getOrCreateUserData(thanksRecieverID, originalMessage.author.username);

        // get user data for sender
        let senderData = await this.userManager.getOrCreateUserData(thanksSenderID, message.author.username);

        // const doesSenderHaveEnoughPoints = senderData.thankedBuffer.length >= this.getConfigManager().getConfig(GuildConfigs.HELPER_ROLE_THRESHOLD);


        // Check if the sender has already thanked the receiver in the last 24 hours
        const now = Date.now();
        const minTime = 24 * 60 * 60 * 1000; // 24 hours
        // if (senderData.lastThanked && (now - senderData.lastThanked < minTime)) {
        //     const embed = new EmbedBuilder()
        //         .setColor(0x00FF00) // Green color for thank you message
        //         .setTitle(`No Points Given!`)
        //         .setDescription(`You've already given a point to someone in the last 24 hours. Thank you anyway for being great!`)
        //         .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
        //     await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
        //     return;
        // }
        if (userData.thankedBuffer.some(thank => thank.thankedBy === thanksSenderID && now - thank.timestamp < minTime)) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00) // Green color for thank you message
                .setTitle(`Point Already Given!`)
                .setDescription(`You've already thanked <@${thanksRecieverID}> in the last 24 hours. Thank you anyway for being great!`)
                .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
            await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });

            return; // Already thanked in the last 24 hours
        }

        // check if reciever is blacklisted
        const blacklistedReciever = this.getConfigManager().getConfig(GuildConfigs.THANKS_BLACKLIST).find(user => user.id === thanksRecieverID);
        if (blacklistedReciever) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000) // Red color for error message
                .setTitle(`User Blacklisted!`)
                .setDescription(`<@${thanksRecieverID}> is blacklisted from receiving points because of reason: ${blacklistedReciever.reason}. Thank you for appreciating them anyway!`)
                .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
            await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
            return;
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

        // Update the last thanked timestamp for the sender
        senderData.lastThanked = now;

        await this.userManager.saveUserData(userData);
        await this.userManager.saveUserData(senderData);

        // Send a thank you message in the channel
        const embed = new EmbedBuilder()
            .setColor(0x00FF00) // Green color for thank you message
            .setTitle(`Point Received!`)
            .setDescription(`<@${thanksSenderID}> gave a point to <@${thanksRecieverID}>!`)
            // .addFields(
            //     { name: 'Total points', value: `${userData.thankedCountTotal}`, inline: true },
            //     { name: 'In the past month', value: `${userData.thankedBuffer.length}`, inline: true },
            // )
            .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
        await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
        await this.checkHelper(userData);
    }


    /**
     * Called every second to perform periodic tasks.
     */
    public async loop() {
        if (!this.ready) {
            return;
        }
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
        if (!this.getConfigManager().getConfig(GuildConfigs.HELPER_ROLE_ID)) {
            return;
        }

        const users = await this.userManager.getAllUserIDs();
        for (const userId of users) {
            const userData = await this.userManager.getUserData(userId);
            if (!userData) continue;

            // Purge buffer entries older than 30 days
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            userData.thankedBuffer = userData.thankedBuffer.filter(thank => thank.timestamp >= thirtyDaysAgo);

            // Save updated user data
            await this.userManager.saveUserData(userData);
        }

        const members = await this.guild.members.fetch();
        for (const member of members.values()) {
            const userData = await this.userManager.getUserData(member.id);
            if (!userData) continue;
            await this.checkHelper(userData, member).catch(e => {
                console.error(`Error checking helper role for user ${member.id}:`, e);
            });
        }

    }

    public async checkHelper(userData: UserData, member?: GuildMember) {
        const inBlacklist = this.getConfigManager().getConfig(GuildConfigs.THANKS_BLACKLIST).some(user => user.id === userData.id);
        const shouldHaveHelperRole = !inBlacklist && !userData.disableRole && userData.thankedBuffer.length >= this.getConfigManager().getConfig(GuildConfigs.HELPER_ROLE_THRESHOLD);
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

        member = member || await guild.members.fetch(userData.id).catch(() => undefined);
        if (!member) {
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
            } else if (changes.tags) {
                embed.setTitle(`Updated tags for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.authors) {
                embed.setTitle(`Updated authors for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.endorsers) {
                embed.setTitle(`Updated endorsers for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.images) {
                embed.setTitle(`Updated images for ${newEntryData.code} in ${forumChannel.name}`);
            } else if (changes.attachments) {
                embed.setTitle(`Updated attachments for ${newEntryData.code} in ${forumChannel.name}`);
            } else {

                let changed = false;
                if (changes.records) {
                    for (const [key, change] of Object.entries(changes.records)) {
                        if (change.old && change.new) {
                            embed.setTitle(`Updated ${key} for ${newEntryData.code} in ${forumChannel.name}`);
                        } else if (change.old) {
                            embed.setTitle(`Removed ${key} for ${newEntryData.code} in ${forumChannel.name}`);
                        } else if (change.new) {
                            embed.setTitle(`Added ${key} for ${newEntryData.code} in ${forumChannel.name}`);
                        }
                        changed = true;
                        break;
                    }
                }

                if (!changed) {
                    return; // No significant changes to log
                }
            }

            embed.setDescription(`**Name:** ${newEntryData.name}\n[Submission Thread](${submissionThread.url})`);
            embed.setURL(newEntryData.post?.threadURL || '');

            const fields = [];
            if (changes.code) fields.push({ name: 'Code', value: `*${oldEntryData.code}* → *${newEntryData.code}*` });
            if (changes.name) fields.push({ name: 'Name', value: `*${oldEntryData.name}* → *${newEntryData.name}*` });
            if (changes.authors) fields.push({ name: 'Authors', value: `*${getAuthorsString(oldEntryData.authors)}* → *${getAuthorsString(newEntryData.authors)}*` });
            if (changes.endorsers) fields.push({ name: 'Endorsers', value: `*${getAuthorsString(oldEntryData.endorsers)}* → *${getAuthorsString(newEntryData.endorsers)}*` });
            if (changes.tags) fields.push({ name: 'Tags', value: `*${oldEntryData.tags.map(t => t.name).join(', ')}* → *${newEntryData.tags.map(t => t.name).join(', ')}*` });

            if (changes.records) {
                for (const [key, change] of Object.entries(changes.records)) {
                    if (change.old && change.new) {
                        fields.push({ name: key, value: `*${countCharactersInRecord(change.old)} characters* → *${countCharactersInRecord(change.new)} characters*` });
                    } else if (change.old) {
                        fields.push({ name: key, value: `Removed ${countCharactersInRecord(change.old)} characters` });
                    } else if (change.new) {
                        fields.push({ name: key, value: `Added ${countCharactersInRecord(change.new)} characters` });
                    }
                }
            }

            if (changes.images) fields.push({ name: 'Images', value: `*${oldEntryData.images.length} images* → *${newEntryData.images.length} images*` });
            if (changes.attachments) fields.push({ name: 'Attachments', value: `*${oldEntryData.attachments.map(o => escapeDiscordString(o.name)).join(", ")} attachments* → *${newEntryData.attachments.map(o => escapeDiscordString(o.name)).join(", ")} attachments*` });
            embed.addFields(fields);
            embed.setColor(0xFFFF00); // Yellow for update
        }

        embed.setTimestamp();

        await logChannel.send({
            embeds: [embed],
        });
    }


    public async onPostAdd(entryData: ArchiveEntryData) {
        await this.updateDesigers(entryData.id, [], entryData.authors).catch(e => {
            console.error(`Error adding designers for entry ${entryData.id}:`, e);
        });
    }

    public async onPostUpdate(oldEntryData: ArchiveEntryData, newEntryData: ArchiveEntryData) {
        await this.updateDesigers(newEntryData.id, oldEntryData.authors, newEntryData.authors).catch(e => {
            console.error(`Error updating designers for entry ${newEntryData.id}:`, e);
        });
    }

    public async onPostDelete(entryData: ArchiveEntryData) {
        await this.updateDesigers(entryData.id, entryData.authors, []).catch(e => {
            console.error(`Error removing designers for entry ${entryData.id}:`, e);
        });
    }

    public async updateDesigers(entryId: Snowflake, oldAuthors: Author[], newAuthors: Author[]) {
        const oldDesigners = oldAuthors.filter(a => a.type === AuthorType.DiscordInGuild && !a.dontDisplay).map(a => a.id || "");
        const newDesigners = newAuthors.filter(a => a.type === AuthorType.DiscordInGuild && !a.dontDisplay).map(a => a.id || "");

        const addedDesigners = newDesigners.filter(id => !oldDesigners.includes(id));
        const removedDesigners = oldDesigners.filter(id => !newDesigners.includes(id));
        const designerRoleId = this.getConfigManager().getConfig(GuildConfigs.DESIGNER_ROLE_ID);

        for (const designerId of addedDesigners) {
            // get userdata for designer
            const member = await this.getGuild().members.fetch(designerId).catch(() => undefined);
            if (!member) {
                continue; // Skip if member not found
            }
            let userData = await this.userManager.getOrCreateUserData(designerId, member.user.username);
            if (!userData.archivedPosts) {
                userData.archivedPosts = [];
            }
            if (!userData.archivedPosts.includes(entryId)) {
                userData.archivedPosts.push(entryId);
            }

            await this.userManager.saveUserData(userData);

            if (!member.roles.cache.has(designerRoleId)) {
                const designerRole = this.getGuild().roles.cache.get(designerRoleId);
                if (designerRole) {
                    try {
                        await member.roles.add(designerRole);
                    } catch (e) {
                        console.error(`Failed to add designer role to ${member.user.username}:`, e);
                    }
                } else {
                    console.warn(`Designer role with ID ${designerRoleId} not found in guild ${this.getGuild().name}`);
                }
            }
        }

        for (const designerId of removedDesigners) {
            // get userdata for designer
            const member = await this.getGuild().members.fetch(designerId).catch(() => undefined);
            if (!member) {
                continue; // Skip if member not found
            }
            let userData = await this.userManager.getOrCreateUserData(designerId, member.user.username);
            if (!userData.archivedPosts) {
                userData.archivedPosts = [];
            }
            userData.archivedPosts = userData.archivedPosts.filter(id => id !== entryId);

            await this.userManager.saveUserData(userData);

            if (member.roles.cache.has(designerRoleId) && userData.archivedPosts.length === 0) {
                const designerRole = this.getGuild().roles.cache.get(designerRoleId);
                if (designerRole) {
                    try {
                        await member.roles.remove(designerRole);
                    } catch (e) {
                        console.error(`Failed to remove designer role from ${member.user.username}:`, e);
                    }
                } else {
                    console.warn(`Designer role with ID ${designerRoleId} not found in guild ${this.getGuild().name}`);
                }
            }
        }
    }

    public async rebuildDesignerRoles() {
        const allDesignerIdsToPosts = new Map<Snowflake, Snowflake[]>();
        await this.getRepositoryManager().iterateAllEntries(async (entry) => {
            entry.getData().authors.filter(a => a.type === AuthorType.DiscordInGuild && !a.dontDisplay).forEach(author => {
                if (author.id) {
                    if (!allDesignerIdsToPosts.has(author.id)) {
                        allDesignerIdsToPosts.set(author.id, []);
                    }
                    allDesignerIdsToPosts.get(author.id)?.push(entry.getData().id);
                }
            });
        });

        // Give user data to all designers
        for (const [designerId, posts] of allDesignerIdsToPosts.entries()) {
            let userData = await this.userManager.getUserData(designerId);
            if (!userData) {
                const member = await this.getGuild().members.fetch(designerId).catch(() => undefined);
                if (!member) {
                    continue; // Skip if member not found
                }
                userData = await this.userManager.getOrCreateUserData(designerId, member.user.username);
                // save user data
                userData.archivedPosts = posts;
                await this.userManager.saveUserData(userData);
            }
        }

        // Now update all user data
        const userIDs = await this.userManager.getAllUserIDs();
        for (const userId of userIDs) {
            const userData = await this.userManager.getUserData(userId);
            if (!userData) continue;

            // Get the posts for this user
            const posts = allDesignerIdsToPosts.get(userId) || [];
            userData.archivedPosts = posts;

            // Save the updated user data
            await this.userManager.saveUserData(userData);

            // Update roles if necessary
            const member = await this.getGuild().members.fetch(userId).catch(() => undefined);
            if (member) {
                const designerRoleId = this.getConfigManager().getConfig(GuildConfigs.DESIGNER_ROLE_ID);
                if (designerRoleId && member.roles.cache.has(designerRoleId) && posts.length === 0) {
                    const designerRole = this.getGuild().roles.cache.get(designerRoleId);
                    if (designerRole) {
                        try {
                            await member.roles.remove(designerRole);
                        } catch (e) {
                            console.error(`Failed to remove designer role from ${member.user.username}:`, e);
                        }
                    } else {
                        console.warn(`Designer role with ID ${designerRoleId} not found in guild ${this.getGuild().name}`);
                    }
                } else if (designerRoleId && !member.roles.cache.has(designerRoleId) && posts.length > 0) {
                    const designerRole = this.getGuild().roles.cache.get(designerRoleId);
                    if (designerRole) {
                        try {
                            await member.roles.add(designerRole);
                        } catch (e) {
                            console.error(`Failed to add designer role to ${member.user.username}:`, e);
                        }
                    } else {
                        console.warn(`Designer role with ID ${designerRoleId} not found in guild ${this.getGuild().name}`);
                    }
                }
            }
        }
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

    public getSchema(): any {
        return this.getConfigManager().getConfig(GuildConfigs.POST_SCHEMA);
    }

    public getUserManager(): UserManager {
        return this.userManager;
    }
}