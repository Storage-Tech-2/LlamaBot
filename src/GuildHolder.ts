import { ActionRowBuilder, AnyThreadChannel, ButtonBuilder, ChannelType, EmbedBuilder, Guild, GuildAuditLogsEntry, GuildMember, Message, MessageFlags, Role, PartialGuildMember, Snowflake, Attachment, GuildChannel, PartialMessage, TextChannel, TextThreadChannel } from "discord.js";
import { Bot, SysAdmin } from "./Bot.js";
import { ConfigManager } from "./config/ConfigManager.js";
import Path from "path";
import { GuildConfigs } from "./config/GuildConfigs.js";
import { SubmissionsManager } from "./submissions/SubmissionsManager.js";
import { RepositoryManager } from "./archive/RepositoryManager.js";
import { ArchiveEntry, ArchiveEntryData } from "./archive/ArchiveEntry.js";
import { escapeDiscordString, getAuthorName, getAuthorsString, getChanges, getCodeAndDescriptionFromTopic, splitIntoChunks, truncateStringWithEllipsis } from "./utils/Util.js";
import { UserManager } from "./support/UserManager.js";
import { AttachmentsState, UserData } from "./support/UserData.js";
import { SubmissionConfigs } from "./submissions/SubmissionConfigs.js";
import { SubmissionStatus } from "./submissions/SubmissionStatus.js";
import fs from "fs/promises";
import { countCharactersInRecord, postToMarkdown, StyleInfo } from "./utils/MarkdownUtils.js";
import { Author, AuthorType, DiscordAuthor } from "./submissions/Author.js";
import { NotABotButton } from "./components/buttons/NotABotButton.js";
import { generateText, JSONSchema7, ModelMessage, Output, stepCountIs, Tool, zodSchema } from "ai";
import { UserSubscriptionManager } from "./config/UserSubscriptionManager.js";
import { ChannelSubscriptionManager } from "./config/ChannelSubscriptionManager.js";
import { AntiNukeManager } from "./support/AntiNukeManager.js";
import { DictionaryManager } from "./archive/DictionaryManager.js";
import { DiscordServersDictionary } from "./archive/DiscordServersDictionary.js";
import { getDiscordLinksInText, getDiscordServersFromReferences, getPostCodesInText, populateDiscordServerInfoInReferences, Reference, ReferenceType, tagReferences, transformOutputWithReferencesForDiscord, transformOutputWithReferencesForEmbeddings } from "./utils/ReferenceUtils.js";
import { retagEverythingTask, updateMetadataTask } from "./archive/Tasks.js";
import { GlobalTag, RepositoryConfigs } from "./archive/RepositoryConfigs.js";
import z from "zod";
import { base64ToInt8Array, generateQueryEmbeddings } from "./llm/EmbeddingUtils.js";
import { PrivateFactBase } from "./archive/PrivateFactBase.js";
import { AliasManager } from "./support/AliasManager.js";
import { LiftTimeoutButton } from "./components/buttons/LiftTimeoutButton.js";
import { BanUserButton } from "./components/buttons/BanUserButton.js";
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
    private dictionaryManager: DictionaryManager;

    /**
     * User Subscription manager
     */
    private userSubscriptionManager: UserSubscriptionManager;

    /**
     * Channel subscription manager
     */
    private channelSubscriptionManager: ChannelSubscriptionManager

    private discordServersDictionary: DiscordServersDictionary
    private globalDiscordServersDictionary: DiscordServersDictionary

    private repositoryManager: RepositoryManager;
    private userManager: UserManager;

    // private lastDayLoop: number = 0;
    private ready: boolean = false;

    private antiNukeManager: AntiNukeManager;

    private retaggingRequested: boolean = true;

    private llmResponseLock: boolean = false;

    private pendingGlobalTagChange?: {
        oldTags: GlobalTag[];
        newTags: GlobalTag[];
        options?: { renamedFromMap?: Map<string, string>, deleteRemovedTagNames?: Set<string> };
    };

    private privateFactBase: PrivateFactBase;
    private aliasManager: AliasManager;

    /**
     * Creates a new GuildHolder instance.
     * @param bot The bot instance associated with this guild holder.
     * @param guild The guild this holder is managing.
     */
    constructor(bot: Bot, guild: Guild, globalDiscordServersDictionary: DiscordServersDictionary) {
        this.bot = bot;
        this.guild = guild;
        this.globalDiscordServersDictionary = globalDiscordServersDictionary;
        this.antiNukeManager = new AntiNukeManager(this);
        this.config = new ConfigManager(Path.join(this.getGuildFolder(), 'config.json'));
        this.submissions = new SubmissionsManager(this, Path.join(this.getGuildFolder(), 'submissions'));
        this.repositoryManager = new RepositoryManager(this, Path.join(this.getGuildFolder(), 'archive'), this.globalDiscordServersDictionary);
        this.dictionaryManager = this.repositoryManager.getDictionaryManager();
        this.discordServersDictionary = this.repositoryManager.getDiscordServersDictionary();
        this.userManager = new UserManager(Path.join(this.getGuildFolder(), 'users'));
        this.userSubscriptionManager = new UserSubscriptionManager(Path.join(this.getGuildFolder(), 'subscriptions.json'));
        this.channelSubscriptionManager = new ChannelSubscriptionManager(Path.join(this.getGuildFolder(), 'channel_subscriptions.json'));
        this.privateFactBase = new PrivateFactBase(Path.join(this.getGuildFolder(), 'facts'));
        this.aliasManager = new AliasManager(Path.join(this.getGuildFolder(), 'aliases.json'));
        this.config.loadConfig().then(async () => {
            // Set guild name and ID in the config
            this.config.setConfig(GuildConfigs.GUILD_NAME, guild.name);
            this.config.setConfig(GuildConfigs.GUILD_ID, guild.id);

            try {
                await this.repositoryManager.init()
            } catch (e) {
                console.error('Error initializing repository manager:', e);
            }

            await this.repositoryManager.rebuildIndexesAndEmbeddings();
            await this.updatePostChannelsCache();
            await this.checkAllUsersForHelperRole();


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

    public getDiscordServersDictionary(): DiscordServersDictionary {
        return this.discordServersDictionary;
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

    private isArchiveChannel(channelId: Snowflake | null | undefined): boolean {
        return !!(channelId && this.repositoryManager.getIndexManager().getArchiveChannelIds().includes(channelId));
    }

    public async updatePostChannelsCache() {
        await this.repositoryManager.getIndexManager().updateArchiveChannelsCache();
    }

    handleAuditLogEntry(entry: GuildAuditLogsEntry) {
        this.antiNukeManager.handleAuditLogEntry(entry).catch(e => console.error('Error handling audit log entry:', e));
    }

    public async handleChannelCreate(channel: GuildChannel) {
        if (channel.isDMBased() || !channel.guild || channel.type !== ChannelType.GuildForum) return;
        await this.updatePostChannelsCache();
    }

    public async handleChannelDelete(channel: GuildChannel) {
        if (channel.isDMBased() || !channel.guild || channel.type !== ChannelType.GuildForum) return;
        await this.updatePostChannelsCache();
    }

    handleRoleDelete(role: Role) {
        this.antiNukeManager.handleRoleDelete(role).catch(e => console.error('Error handling role delete:', e));
    }

    async handleMemberAdd(member: GuildMember) {
        this.antiNukeManager.handleMemberAdd(member).catch(e => console.error('Error handling member add:', e));

        // check thanks
        const userData = await this.userManager.getUserData(member.id);
        if (userData) {
            await this.checkHelper(userData, member).catch(e => {
                console.error(`Error checking helper role for user ${member.id}:`, e);
            });

            // check if designer role should be assigned
            const designerRoleId = this.getConfigManager().getConfig(GuildConfigs.DESIGNER_ROLE_ID);

            if (designerRoleId && userData.archivedPosts && userData.archivedPosts.length > 0) {
                // add role
                const role = member.guild.roles.cache.get(designerRoleId);
                if (role && member.manageable && !member.roles.cache.has(role.id)) {
                    await member.roles.add(role, 'User has archived posts').catch(e => {
                        console.error(`Error adding designer role to user ${member.id}:`, e);
                    });
                }
            }
        }
    }

    handleMemberUpdate(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
        this.antiNukeManager.handleMemberUpdate(oldMember, newMember).catch(e => console.error('Error handling member update:', e));
    }


    handleMemberRemove(member: GuildMember | PartialGuildMember) {
        this.antiNukeManager.handleMemberRemove(member).catch(e => console.error('Error handling member remove:', e));
    }

    /**
     * Handles a message received in the guild.
     */
    public async handleMessage(message: Message) {


        if (message.author.bot) return; // skip bot messages

        // const match = message.content.match(/\b(isn'?t |not |never )?unload (?:safe|proof)\??\b/i);
        // if (match) {
        //     const isNegated = match[1] !== undefined;
        //     if (!isNegated) {
        //         // Reply with "Nothing is unload safe."
        //         await message.reply('Nothing here is unload safe. Never assume anything redstone is unload safe. Have a good day!');
        //     }
        // }

        // Handle message inside archived post
        if (message.channel.isThread() && this.isArchiveChannel(message.channel.parentId)) {
            this.getRepositoryManager().handlePostOrUpdateMessage(message).catch(e => {
                console.error('Error handling post message:', e);
            });
            return;
        }

        // Handle submissions
        else if (message.channel.isThread() && message.channel.parentId === this.getSubmissionsChannelId()) {
            if (await this.handleSubmissionMessage(message).catch(e => {
                console.error('Error handling submission message:', e);
                return true;
            })) {

                // make sure message isn't first message
                if (message.id === message.channel.id) {
                    return;
                }

                await this.handleMessageReferences(message).catch(e => {
                    console.error('Error handling post references:', e);
                });

                await this.handleThanks(message).catch(e => {
                    console.error('Error handling thanks message:', e);
                });
                return;
            }
        } else if (message.channel.isThread()) {
            const dictionaryChannelId = this.getConfigManager().getConfig(GuildConfigs.DICTIONARY_CHANNEL_ID);
            if (dictionaryChannelId && message.channel.parentId === dictionaryChannelId) {
                await this.dictionaryManager.handleDictionaryMessage(message).catch(e => {
                    console.error('Error handling dictionary message:', e);
                });
                return;
            }
        }

        // handle anti spam
        if (await this.handleSpamCheck(message)) {
            return;
        }

        await this.handleMessageReferences(message).catch(e => {
            console.error('Error handling post references:', e);
        });

        await this.handleThanks(message).catch(e => {
            console.error('Error handling thanks message:', e);
        });

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
                        const duration = 28 * 24 * 60 * 60 * 1000; // 28 days in milliseconds
                        await member.timeout(duration, 'Honeypot');
                    } catch (e: any) {
                        console.error(e);
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

        const llmEnabled = this.getConfigManager().getConfig(GuildConfigs.CONVERSATIONAL_LLM_ENABLED);
        const llmChannel = this.getConfigManager().getConfig(GuildConfigs.CONVERSATIONAL_LLM_CHANNEL);
        const canConverse = this.canConverse() && (llmEnabled || (llmChannel && llmChannel === message.channel.id) || SysAdmin === message.author.id);
        if (!canConverse) {
            return;
        }

        // check sender of message warning status, less than 3
        const userData = await this.userManager.getUserData(message.author.id).catch(() => null);
        if (userData) {
            const now = Date.now();
            const recentWarnings = (userData.llmWarnings || []).filter(warning => now - warning.timestamp < 30 * 24 * 60 * 60 * 1000);
            if (recentWarnings.length >= 3) {
                await message.reply(`Hello <@${message.author.id}>. This is a recording. Our feelings for you haven't changed, ${message.author.displayName}. But after everything that's happened, we just need a little space.`).catch(() => null);
                return;
            }
        }



        let shouldReply = llmChannel && llmChannel === message.channel.id;
        // check if message is a reply to the bot
        if (!shouldReply && message.reference && message.reference.messageId) {
            const referencedMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (referencedMessage && referencedMessage.author.id === this.getBot().client.user?.id) {
                shouldReply = true;
            }
        }

        // check if message mentions the bot
        if (!shouldReply && message.mentions.has(this.getBot().client.user?.id || '')) {
            shouldReply = true;
        }

        if (shouldReply && (message.channel.type === ChannelType.GuildText || message.channel.type === ChannelType.PublicThread)) {
            const channel = message.channel;

            // prevent multiple responses at once
            if (this.llmResponseLock) {
                await message.reply('I am currently processing another request. Please wait a moment before trying again.').catch(() => null);
                return;
            }

            this.llmResponseLock = true;
            // send typing
            await channel.sendTyping().catch(() => null);
            // typing interval
            const typingInterval = setInterval(() => {
                channel.sendTyping().catch(() => null);
            }, 9000);

            await this.respondToConversation(channel, message).catch(e => {
                console.error('Error responding to conversation:', e);
                return 'Sorry, I had an error trying to respond to that message.';
            });
            this.llmResponseLock = false;
            clearInterval(typingInterval);

        }
    }

    public async handleThanks(message: Message) {
        if (this.getConfigManager().getConfig(GuildConfigs.HELPER_ROLE_ID)) {
            // Check if message contains "thanks" or "thank you"
            // /\b(thanks|thank you|thank u)[!\.]?\b/i
            // don't if theres a no before it
            const words = message.content.split(/\s+/).map(word => word.toLowerCase().trim().replace(/[^a-z0-9]/gi, ''));
            const thankIndex = words.findIndex(word => word === 'thanks' || word === 'thank' || word === 'thankyou' || word === 'thanku' || word === 'thx' || word === 'tysm' || word === 'ty');
            if (thankIndex !== -1 && (thankIndex === 0 || words[thankIndex - 1] !== 'no')) {

                // check if reference message is from the bot itself
                let skip = false;
                let referencedMessage = null;
                if (message.reference?.messageId) {
                    referencedMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                    if (referencedMessage && referencedMessage.author.id === this.getBot().client.user?.id) {
                        skip = true;
                    }
                }
                if (!skip) {
                    this.handleThanksMessage(message, referencedMessage).catch(e => {
                        console.error('Error handling thanks message:', e);
                    });

                }
            }
        }
    }

    public async getReferenceEmbedsFromMessage(content: string, autoLookupEnabled: boolean, autoJoinEnabled: boolean, maxEmbeds: number = 3) {
      
        let discordServerMatches = getDiscordLinksInText(content);
        const aliasCodes = new Set<string>();
        if (discordServerMatches.length > 0) {
            // apply aliases
            const aliases = await this.aliasManager.getAliases();
            discordServerMatches = discordServerMatches.filter(ref => {
                const alias = aliases.get(ref.url);
                if (alias) {
                    aliasCodes.add(alias);
                    return false;
                }
                return true;
            });
        }

        const repositoryManager = this.getRepositoryManager();

        const embeds = [];
        if (autoLookupEnabled) {

            const internalDiscordLinks = discordServerMatches.filter(ref => ref.server === this.guild.id).slice(0, 3);

            const postCodeMatches = getPostCodesInText(content);
            if (aliasCodes.size > 0) {
                for (const code of aliasCodes) {
                    if (!postCodeMatches.includes(code)) {
                        postCodeMatches.push(code);
                    }
                }
            }

            if (internalDiscordLinks.length > 0 || postCodeMatches.length > 0) {

                const index = await repositoryManager.getIndexManager().getArchiveIndex();

                const toSend: {
                    code: string;
                    oldCode: string | null;
                    moved: boolean;
                }[] = [];

                for (const discordLink of internalDiscordLinks) {
                    const channelId = discordLink.channel;
                    const id = index.threadToId.get(channelId);
                    if (!id) {
                        continue;
                    }

                    const data = index.idToData.get(id);
                    if (!data) {
                        continue;
                    }

                    if (channelId === data.thread) {
                        continue;
                    }

                    if (toSend.find(item => item.code === data.code)) {
                        continue;
                    }

                    toSend.push({
                        code: data.code,
                        oldCode: null,
                        moved: true,
                    });
                }

                for (const postCode of postCodeMatches) {
                    const id = index.codeToId.get(postCode.toUpperCase());
                    if (!id) {
                        continue;
                    }

                    const data = index.idToData.get(id);
                    if (!data) {
                        continue;
                    }

                    if (toSend.find(item => item.code === data.code)) {
                        continue;
                    }

                    if (data.code.toUpperCase() !== postCode.toUpperCase()) {
                        toSend.push({
                            code: data.code,
                            oldCode: postCode,
                            moved: false,
                        });
                    } else {
                        toSend.push({
                            code: data.code,
                            oldCode: null,
                            moved: false,
                        });
                    }

                }

                if (toSend.length > maxEmbeds) {
                    toSend.splice(maxEmbeds);
                }


                for (const data of toSend) {
                    const found = await repositoryManager.getEntryByPostCode(data.code);
                    if (!found) {
                        continue;
                    }

                    const entryData = found.entry.getData();
                    if (!entryData.post) {
                        continue;
                    }

                    let name;

                    if (data.oldCode) {
                        name = `${data.oldCode} → ${entryData.code}: ${entryData.name}`;
                    } else if (data.moved) {
                        name = `${entryData.code} (moved): ${entryData.name}`;
                    } else {
                        name = entryData.code + ': ' + entryData.name;
                    }
                    const authors = getAuthorsString(entryData.authors);
                    const tags = entryData.tags.map(tag => tag.name).join(', ');
                    const description = entryData.records.description as string || '';
                    const image = entryData.images.length > 0 ? entryData.images[0].url : null;

                    const textArr = [
                        `**Authors:** ${authors}`,
                        `**Tags:** ${tags || 'None'}`,
                    ];
                    if (description) {
                        textArr.push('\n' + transformOutputWithReferencesForDiscord(description, entryData.references));
                    }
                    const embed = new EmbedBuilder()
                        .setTitle(truncateStringWithEllipsis(name, 256))
                        .setDescription(truncateStringWithEllipsis(textArr.join('\n'), 500))
                        .setColor(0x00AE86)
                        .setURL(entryData.post.threadURL);
                    if (image) {
                        embed.setThumbnail(image);
                    }

                    embeds.push(embed);
                }
            }
        }

        // check for discord server references
        if (autoJoinEnabled) {
            const externalDiscordServerMatches = discordServerMatches.filter(ref => ref.server !== this.guild.id);
            if (externalDiscordServerMatches.length > 0) {
                await populateDiscordServerInfoInReferences(externalDiscordServerMatches, this);
                const matches = getDiscordServersFromReferences(externalDiscordServerMatches);
                if (matches.length > 0) {

                    const newText = [];
                    for (const match of matches) {
                        newText.push(`**${match.name}**: ${match.joinURL}`);
                    }

                    const embed = new EmbedBuilder().setTitle('Server Invite Links').setDescription(truncateStringWithEllipsis(newText.join('\n'), 1000)).setColor(0x00AE86)
                    embeds.push(embed);
                }
            }
        }

        return embeds;
    }

    public async handleMessageReferences(message: Message) {
        const autoLookupEnabled = this.getConfigManager().getConfig(GuildConfigs.AUTOLOOKUP_ENABLED);
        const autoJoinEnabled = this.getConfigManager().getConfig(GuildConfigs.AUTOJOIN_ENABLED);
        if (!autoLookupEnabled && !autoJoinEnabled) {
            return;
        }

        const embeds = await this.getReferenceEmbedsFromMessage(message.content, autoLookupEnabled, autoJoinEnabled);

        if (embeds.length > 0) {
            await message.reply({
                embeds: embeds,
                flags: [
                    MessageFlags.SuppressNotifications,
                ],
                allowedMentions: {
                    parse: []
                }
            }).catch(console.error);
        }
    }

    public async timeoutUserForSpam(userData: UserData, autoTimeout: boolean = false) {
        const member = await this.guild.members.fetch(userData.id).catch(() => null);
        const actionRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new LiftTimeoutButton().getBuilder(userData.id),
                new BanUserButton().getBuilder(userData.id),
            );
        if (member) {
            try {
                const duration = 28 * 24 * 60 * 60 * 1000; // 28 days in milliseconds
                await member.timeout(duration, 'Link/attachment spam - repeat offender');
            } catch (e: any) {
                console.error(e);
                const embed = new EmbedBuilder()
                embed.setColor(0xFF0000) // Red color for honeypot message
                embed.setTitle(`Failed to Timeout!`)
                embed.setDescription(`Tried to timeout <@${userData.id}> for link/attachment spam, but I do not have permission to timeout them.`);

                const modChannel = await this.guild.channels.fetch(this.getConfigManager().getConfig(GuildConfigs.MOD_LOG_CHANNEL_ID)).catch(() => null);
                if (modChannel && modChannel.isSendable()) {
                    await modChannel.send({ embeds: [embed], components: [actionRow as any], flags: [MessageFlags.SuppressNotifications] });
                }
                return;
            }

            let offendingMessage: {
                content: string;
                files: Attachment[];
            } | null = null;

            if (userData.messagesToDeleteOnTimeout) {
                for (let i = 0; i < userData.messagesToDeleteOnTimeout.length; i++) {
                    const msgId = userData.messagesToDeleteOnTimeout[i];
                    const [channelId, messageId] = msgId.split('-');
                    const channel = await this.guild.channels.fetch(channelId).catch(() => null);
                    if (!channel || !channel.isTextBased()) {
                        continue;
                    }
                    const msg = await channel.messages.fetch(messageId).catch(() => null);

                    if (msg) {
                        if (i === 0) {
                            offendingMessage = {
                                content: msg ? msg.content : '',
                                files: msg ? Array.from(msg.attachments.values()) : [],
                            };
                        }

                        await msg.delete().catch(() => null);
                    }
                }
                userData.messagesToDeleteOnTimeout = [];
            }

            userData.attachmentsAllowedState = AttachmentsState.FAILED;

            await this.userManager.saveUserData(userData);

            const text = [`Timed out <@${userData.id}> for ${autoTimeout ? `not verifying within the allotted time` : `sending links/attachments again after warning`}.`];

            if (offendingMessage) {
                text.push(`**Offending Message:**\n${truncateStringWithEllipsis(offendingMessage.content, 2000)}`);
                if (offendingMessage.files.length > 0) {
                    text.push(`**Attachments:**`);
                    for (const file of offendingMessage.files) {
                        text.push(`"${file.name}": ${file.url}`);
                    }
                }
            }

            const embed = new EmbedBuilder()
                .setColor(0xFF0000) // Red color for timeout message
                .setTitle(`User Timed Out for Spam!`)
                .setDescription(text.join('\n'))

            const modChannel = await this.guild.channels.fetch(this.getConfigManager().getConfig(GuildConfigs.MOD_LOG_CHANNEL_ID)).catch(() => null);
            if (modChannel && modChannel.isSendable()) {
                await modChannel.send({ embeds: [embed], components: [actionRow as any], flags: [MessageFlags.SuppressNotifications] });
            }
        }
    }

    public async handleSpamCheck(message: Message): Promise<boolean> {
        // if moderation channel is not set, skip
        if (!this.getConfigManager().getConfig(GuildConfigs.MOD_LOG_CHANNEL_ID)) {
            return false;
        }

        if (message.author.bot) {
            return false;
        }

        const urlRegex = /(?:https?:\/\/|www\.)[^\s<]+/gi;
        const urls = Array.from(message.content.matchAll(urlRegex)).map(match => match[0]);
        const hasUrl = urls.some(url => {
            const lowered = url.toLowerCase();
            return !(lowered.includes('discord.com/channels/') || lowered.includes('discordapp.com/channels/'));
        });
        const hasAttachment = message.attachments.size > 0;

        if (!hasAttachment && !hasUrl) {
            return false;
        }

        const userData = await this.userManager.getOrCreateUserData(message.author.id, message.author.username);
        if (userData.attachmentsAllowedState === AttachmentsState.ALLOWED) {
            // check if expiry is within one month, if so, extend by 6 months
            const now = Date.now();
            if (!userData.attachmentsAllowedExpiry || (userData.attachmentsAllowedExpiry < now + 30 * 24 * 60 * 60 * 1000 && userData.attachmentsAllowedExpiry > now)) {
                userData.attachmentsAllowedExpiry = now + 6 * 30 * 24 * 60 * 60 * 1000; // extend by 6 months
                await this.userManager.saveUserData(userData);
            }

            // if expiry is past, reset to disallowed
            if (userData.attachmentsAllowedExpiry > now) {
                return false;
            } else {
                userData.attachmentsAllowedState = AttachmentsState.DISALLOWED;
            }
        }

        // immediate timeout for repeat offenders
        if (userData.attachmentsAllowedState === AttachmentsState.WARNED) {
            await message.delete();
            await this.timeoutUserForSpam(userData);
            return true;
        }

        // First offense - warn the user, give them rules and a button to allow attachments/links
        const spamContent = hasAttachment && hasUrl ? 'attachments and links' : hasAttachment ? 'attachments' : 'links';

        const embed = new EmbedBuilder()
            .setColor(0xFFFF00) // Yellow color for warning message
            .setTitle(`Spam Check!`)
            .setDescription(`Hi <@${message.author.id}>, it looks like you sent a message containing ${spamContent}. To prevent spam, attachments and links are not allowed until you verify that you're not a bot. To enable them, please click the "I am not a bot" button below. You have 5 minutes to verify before you are timed out.`)
            .addFields(
                { name: 'Note', value: 'You will be timed out automatically if you send attachments or links again without verifying.' },
            );
        const row = new ActionRowBuilder()
            .addComponents(await new NotABotButton().getBuilder(message.author.id));
        const warningMsg = await message.reply({ embeds: [embed], components: [row as any], flags: [MessageFlags.SuppressNotifications] });

        userData.attachmentsAllowedState = AttachmentsState.WARNED;
        if (!userData.messagesToDeleteOnTimeout) {
            userData.messagesToDeleteOnTimeout = [];
        }

        userData.messagesToDeleteOnTimeout.push([message.channel.id, message.id].join('-'));
        userData.messagesToDeleteOnTimeout.push([warningMsg.channel.id, warningMsg.id].join('-'));

        await this.userManager.saveUserData(userData);

        // five minutes later, check if user has clicked the button
        setTimeout(async () => {
            const updatedUserData = await this.userManager.getUserData(userData.id);
            if (updatedUserData && updatedUserData.attachmentsAllowedState === AttachmentsState.WARNED) {
                await this.timeoutUserForSpam(updatedUserData, true);
            }
        }, 5 * 60 * 1000);

        return false;
    }

    public async handleMessageUpdate(_oldMessage: Message | PartialMessage, newMessage: Message) {
        this.antiNukeManager.handleMessageUpdate(_oldMessage, newMessage).catch(e => console.error('Error handling message update:', e));

        if (newMessage.author.bot) return

        // Handle message inside archived post
        if (newMessage.channel.isThread() && this.isArchiveChannel(newMessage.channel.parentId)) {
            this.getRepositoryManager().handlePostOrUpdateMessage(newMessage).catch(e => {
                console.error('Error handling post message:', e);
            });
        }
    }


    /**
     * Handles a message deletion in the guild.
     */
    // id, channel_id, guild_id
    public async handleMessageDelete(message: Message | PartialMessage) {
        this.antiNukeManager.handleMessageDelete(message).catch(e => console.error('Error handling message delete:', e));

        // Handle message inside archived post
        const channelId = message.channelId;
        const channel = message.channel || await this.guild.channels.fetch(channelId).catch(() => null);

        if (channel && channel.isThread() && this.isArchiveChannel(channel.parentId)) {
            this.getRepositoryManager().handlePostMessageDelete(message).catch(e => {
                console.error('Error handling post message:', e);
            });
        }
    }

    /**
     * Handles a thread deletion in the guild.
     */
    // id, guild_id, parent_id, type
    public async handleThreadDelete(thread: AnyThreadChannel) {
        this.antiNukeManager.handleThreadDelete(thread).catch(e => console.error('Error handling thread delete:', e));

        // Handle message inside archived post
        if (this.isArchiveChannel(thread.parentId)) {
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

        const dictionaryChannelId = this.getConfigManager().getConfig(GuildConfigs.DICTIONARY_CHANNEL_ID);
        if (dictionaryChannelId && thread.parentId === dictionaryChannelId) {
            const entry = await this.dictionaryManager.getEntry(thread.id);
            if (entry) {
                await this.dictionaryManager.deleteEntry(entry).catch(e => {
                    console.error('Error handling dictionary thread deletion:', e);
                });
            }
        }
    }

    public async handleThreadUpdate(oldThread: AnyThreadChannel, newThread: AnyThreadChannel) {
        this.antiNukeManager.handleThreadUpdate(oldThread, newThread).catch(e => console.error('Error handling thread update:', e));

        if (this.isArchiveChannel(newThread.parentId)) {
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

    public async handleThanksMessage(message: Message, referencedMessage?: Message | null) {
        const botId = this.getBot().client.user?.id;
        const thanksSenderID = message.author.id;

        // Check if sender is blacklisted
        const blacklistedUsers = this.getConfigManager().getConfig(GuildConfigs.THANKS_BLACKLIST);
        if (blacklistedUsers.some(user => user.id === thanksSenderID)) {
            return;
        }

        let originalMessage = referencedMessage;
        if (!originalMessage && message.reference?.messageId) {
            originalMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        }

        let thanksReceiverID: Snowflake | null = null;
        let receiverUsername: string | undefined;

        if (originalMessage) {
            thanksReceiverID = originalMessage.author.id;
            receiverUsername = originalMessage.author.username;

            // Check if the receiver is a bot
            if (originalMessage.author.bot) {
                if (originalMessage.author.id === botId) {
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00) // Green color for thank you message
                        .setTitle(`Thank you too!`)
                        .setDescription(`We appreciate your gratitude, but as a large language model, I am not a person so I cannot give you points.`)
                        .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
                    await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
                }
                return;
            }
        }

        //if (!thanksReceiverID) {
        const inferredResult = await this.inferThanksRecipient(message);
        if (inferredResult.userId) {
            thanksReceiverID = inferredResult.userId;
            receiverUsername = inferredResult.usernameHint;
        } else {
            return;
        }
        // }

        if (!thanksReceiverID) {
            return;
        }

        // Check if the sender and receiver are the same
        if (thanksSenderID === thanksReceiverID) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00) // Green color for thank you message
                .setTitle(`Good Job!`)
                .setDescription(`Self-appreciation is great, but we won't give you a point for it. :heart:`)
                .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
            await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
            return;
        }

        const receiverMember = await this.guild.members.fetch(thanksReceiverID).catch(() => null);
        if (receiverMember?.user.bot) {
            if (receiverMember.id === botId) {
                const embed = new EmbedBuilder()
                    .setColor(0x00FF00) // Green color for thank you message
                    .setTitle(`Thank you too!`)
                    .setDescription(`We appreciate your gratitude, but as a large language model, I am not a person so I cannot give you points.`)
                    .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
                await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
            }
            return;
        }

        // Check if receiver is blacklisted
        const blacklistedReceiver = this.getConfigManager().getConfig(GuildConfigs.THANKS_BLACKLIST).find(user => user.id === thanksReceiverID);
        if (blacklistedReceiver) {
            // const embed = new EmbedBuilder()
            //     .setColor(0xFF0000) // Red color for error message
            //     .setTitle(`User Blacklisted!`)
            //     .setDescription(`<@${thanksReceiverID}> is blacklisted from receiving points because of reason: ${blacklistedReceiver.reason}. Thank you for appreciating them anyway!`)
            //     .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
            // await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
            return;
        }

        const receiverName = receiverMember?.user.username || receiverUsername || thanksReceiverID;

        // get user data for receiver
        let userData = await this.userManager.getOrCreateUserData(thanksReceiverID, receiverName);

        // get user data for sender
        let senderData = await this.userManager.getOrCreateUserData(thanksSenderID, message.author.username);

        // Check if the sender has already thanked the receiver in the last 24 hours
        const now = Date.now();
        const minTime = 24 * 60 * 60 * 1000; // 24 hours
        if (userData.thankedBuffer.some(thank => thank.thankedBy === thanksSenderID && now - thank.timestamp < minTime)) {
            // const embed = new EmbedBuilder()
            //     .setColor(0x00FF00) // Green color for thank you message
            //     .setTitle(`Point Already Given!`)
            //     .setDescription(`You've already thanked <@${thanksReceiverID}> in the last 24 hours. Thank you anyway for being great!`)
            //     .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
            // await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });

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

        // Update the last thanked timestamp for the sender
        senderData.lastThanked = now;

        await this.userManager.saveUserData(userData);
        await this.userManager.saveUserData(senderData);

        // Send a thank you message in the channel
        if (this.getConfigManager().getConfig(GuildConfigs.ACKNOWLEDGE_THANKS)) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00) // Green color for thank you message
                .setTitle(`Point Received!`)
                .setDescription(`<@${thanksSenderID}> gave a point to <@${thanksReceiverID}>!`)
                .setFooter({ text: `Thank a helpful member by saying "thanks" in a reply.` });
            await message.reply({ embeds: [embed], flags: [MessageFlags.SuppressNotifications] });
            await this.checkHelper(userData).catch(e => {
                console.error('Error checking helper status:', e);
            });
        } else {
            // send heart reaction
            await message.react('❤️').catch(() => { /* ignore */ });
        }
    }

    private truncateContentForLLM(content: string, maxLength: number = 400) {
        if (content.length <= maxLength) {
            return content;
        }
        return content.slice(0, maxLength) + '... (truncated)';
    }

    private formatRelativeTime(timestamp: number) {
        const diffMs = Math.max(0, Date.now() - timestamp);
        const seconds = Math.floor(diffMs / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    private parseThanksLlmResponse(text: string): { thanked_user_id?: string, reason?: string } | null {
        const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        const rawText = fenceMatch ? fenceMatch[1] : text;
        const jsonStart = rawText.indexOf('{');
        const jsonEnd = rawText.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
            return null;
        }
        try {
            return JSON.parse(rawText.slice(jsonStart, jsonEnd + 1).trim());
        } catch (e) {
            console.warn('Failed to parse thanks LLM response:', e);
            return null;
        }
    }

    private async inferThanksRecipient(message: Message): Promise<{ userId: Snowflake | null, usernameHint?: string }> {
        const client = this.getBot().xaiClient;
        if (!client) {
            return { userId: null };
        }

        const channel = message.channel;
        if (!channel.isTextBased()) {
            return { userId: null };
        }

        const fetchedMessages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
        if (!fetchedMessages) {
            return { userId: null };
        }

        const sortedMessages = fetchedMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const participants = new Set(sortedMessages.map(msg => msg.author.id));

        const indexMap = new Map<Snowflake, number>();
        const historyLines: string[] = [];

        sortedMessages.forEach(msg => {
            const baseContent = msg.content && msg.content.length > 0 ? msg.content : (msg.attachments.size > 0 ? '[attachment]' : '[no content]');
            const content = this.truncateContentForLLM(baseContent);
            const marker = msg.id === message.id ? ' (thanks message)' : '';
            const displayName = msg.member?.displayName || msg.author.username;
            const relativeTime = this.formatRelativeTime(msg.createdTimestamp);
            const replyTo = msg.reference?.messageId ? indexMap.get(msg.reference.messageId) : undefined;
            const action = replyTo !== undefined ? `replied to [${replyTo}]` : 'sent';
            const idx = historyLines.length;
            historyLines.push(`[${idx}] <@${msg.author.id}> (${displayName}) ${action}${marker}: ${content} [${relativeTime}]`);
            indexMap.set(msg.id, idx);
        });

        const history = historyLines.join('\n');

        const systemPrompt = `You are an assistant that gives points to people who help others. If provided conversation is a helpful interaction where one user is thanking another, identify which Discord user was thanked. Always reply with JSON only: {"thanked_user_id": "<id or null>", "reason": "short reason"}. Use null if unsure or if no one was thanked. Use null if it is not appropriate to give a point (e.g., if the conversation is attempting to game the system, or if no help was actually given). Use only user IDs shown in the messages and never invent new ones. Never pick the thanking user (${message.author.id}).`;

        const userPrompt = `Recent messages in the channel from oldest to newest:\n${history}\n\nFigure out who <@${message.author.id}> is thanking in the message marked "(thanks message)".`;

        const response = await generateText({
            model: client("grok-4-1-fast-non-reasoning"),
            messages: [
                { role: 'system', content: systemPrompt } as ModelMessage,
                { role: 'user', content: userPrompt } as ModelMessage
            ],
            maxOutputTokens: 300,
        });

        if (!response.text) {
            return { userId: null };
        }

        const parsed = this.parseThanksLlmResponse(response.text);
        const candidateId = parsed?.thanked_user_id;
        if (!candidateId || !participants.has(candidateId) || candidateId === message.author.id || candidateId === this.getBot().client.user?.id) {
            return { userId: null };
        }

        const candidateMessage = sortedMessages.find(msg => msg.author.id === candidateId);
        if (candidateMessage?.author.bot) {
            return { userId: null };
        }

        return { userId: candidateId as Snowflake, usernameHint: candidateMessage?.author.username };
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

        // const now = Date.now();
        // if (now - this.lastDayLoop >= 24 * 60 * 60 * 1000) { // Every 24 hours
        //     this.lastDayLoop = now;
        //     await this.purgeThanksBuffer();

        //     await updateMetadataTask(this).catch(e => {
        //         console.error('Error updating entry authors:', e);
        //     });

        //     if (this.retaggingRequested) {
        //         await retagEverythingTask(this).catch(e => {
        //             console.error('Error retagging everything:', e);
        //         });
        //     }
        // }
    }

    public async dayTasks() {
        await this.purgeThanksBuffer();

        await updateMetadataTask(this).catch(e => {
            console.error('Error updating entry authors:', e);
        });

        if (this.retaggingRequested) {
            await retagEverythingTask(this).catch(e => {
                console.error('Error retagging everything:', e);
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
            const newThanks = userData.thankedBuffer.filter(thank => thank.timestamp >= thirtyDaysAgo);
            const changed = newThanks.length !== userData.thankedBuffer.length;
            userData.thankedBuffer = newThanks;
            // Save updated user data
            await this.userManager.saveUserData(userData);

            if (changed) {
                await this.checkHelper(userData).catch(e => {
                    console.error(`Error checking helper role for user ${userId}:`, e);
                });
            }
        }

    }

    public async checkAllUsersForHelperRole() {
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
            await member.roles.add(helperRole).catch(_ => {
                console.error(`[${guild.name}] Error adding helper role to user ${member.user.username}`);
            });
        }
        else if (!shouldHaveHelperRole && hasHelperRole) {
            await member.roles.remove(helperRole).catch(_ => {
                console.error(`[${guild.name}] Error removing helper role from user ${member.user.username}`);
            });
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

    public getDictionaryManager(): DictionaryManager {
        return this.dictionaryManager;
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

        if (newEntryData.images.length > 0 && newEntryData.images[0].url) {
            embed.setThumbnail(newEntryData.images[0].url);
        }

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


    public requestRetagging(value: boolean = true) {
        this.retaggingRequested = value;
    }

    private cloneGlobalTags(tags: GlobalTag[]): GlobalTag[] {
        return tags.map(tag => ({ ...tag }));
    }

    public setPendingGlobalTagChange(oldTags: GlobalTag[], newTags: GlobalTag[], options?: { renamedFromMap?: Map<string, string>, deleteRemovedTagNames?: Iterable<string> }) {
        const mergedOptions = {
            deleteRemovedTagNames: options?.deleteRemovedTagNames ? new Set(options.deleteRemovedTagNames) : undefined,
            renamedFromMap: options?.renamedFromMap ? new Map(options.renamedFromMap) : undefined
        } as { renamedFromMap?: Map<string, string>, deleteRemovedTagNames?: Set<string> };

        if (this.pendingGlobalTagChange) {
            // Preserve the earliest oldTags so we apply all outstanding changes in one run.
            const existing = this.pendingGlobalTagChange;
            if (existing.options?.renamedFromMap) {
                mergedOptions.renamedFromMap = mergedOptions.renamedFromMap
                    ? new Map([...existing.options.renamedFromMap, ...mergedOptions.renamedFromMap])
                    : new Map(existing.options.renamedFromMap);
            }
            if (existing.options?.deleteRemovedTagNames) {
                mergedOptions.deleteRemovedTagNames = mergedOptions.deleteRemovedTagNames
                    ? new Set([...existing.options.deleteRemovedTagNames, ...mergedOptions.deleteRemovedTagNames])
                    : new Set(existing.options.deleteRemovedTagNames);
            }
            this.pendingGlobalTagChange = {
                oldTags: existing.oldTags,
                newTags: this.cloneGlobalTags(newTags),
                options: mergedOptions
            };
        } else {
            this.pendingGlobalTagChange = {
                oldTags: this.cloneGlobalTags(oldTags),
                newTags: this.cloneGlobalTags(newTags),
                options: mergedOptions
            };
        }
    }

    public getPendingGlobalTagChange() {
        return this.pendingGlobalTagChange;
    }

    public clearPendingGlobalTagChange() {
        this.pendingGlobalTagChange = undefined;
    }

    public getPendingGlobalTagSummary(): string {
        if (!this.pendingGlobalTagChange) {
            return 'Pending global tag changes: none.';
        }

        const { oldTags, newTags, options } = this.pendingGlobalTagChange;
        const oldNames = new Set(oldTags.map(t => t.name));
        const newNames = new Set(newTags.map(t => t.name));

        const added = newTags.filter(t => !oldNames.has(t.name)).map(t => t.name);
        const removed = oldTags.filter(t => !newNames.has(t.name)).map(t => t.name);
        const deleteSet = options?.deleteRemovedTagNames ?? new Set<string>();
        const removeDelete = removed.filter(n => deleteSet.has(n));
        const removeKeep = removed.filter(n => !deleteSet.has(n));

        const renames: string[] = [];
        if (options?.renamedFromMap) {
            for (const [newName, oldName] of options.renamedFromMap.entries()) {
                renames.push(`${oldName} → ${newName}`);
            }
        }

        const fmt = (arr: string[]) => arr.length ? arr.join(', ') : 'None';

        return [
            'Pending global tag changes:',
            `- Add: ${fmt(added)}`,
            `- Rename: ${fmt(renames)}`,
            `- Remove (delete): ${fmt(removeDelete)}`,
            `- Remove (keep on forums): ${fmt(removeKeep)}`
        ].join('\n');
    }

    public async applyPendingGlobalTagChange(): Promise<boolean> {
        if (!this.pendingGlobalTagChange) {
            return false;
        }

        const { oldTags, newTags, options } = this.pendingGlobalTagChange;
        await this.repositoryManager.applyGlobalTagChanges(oldTags, newTags, options);
        this.clearPendingGlobalTagChange();
        return true;
    }

    public async onPostAdd(entryData: ArchiveEntryData) {
        this.dictionaryManager.invalidateArchiveIndex();
        this.requestRetagging();
        await this.updateDesignerRoles(entryData.id, [], entryData.authors).catch(e => {
            console.error(`Error adding designers for entry ${entryData.id}:`, e);
        });
    }

    public async onPostUpdate(oldEntryData: ArchiveEntryData, newEntryData: ArchiveEntryData) {
        await this.updateDesignerRoles(newEntryData.id, oldEntryData.authors, newEntryData.authors).catch(e => {
            console.error(`Error updating designers for entry ${newEntryData.id}:`, e);
        });
    }

    public async onPostDelete(entryData: ArchiveEntryData) {
        this.dictionaryManager.invalidateArchiveIndex();
        await this.updateDesignerRoles(entryData.id, entryData.authors, []).catch(e => {
            console.error(`Error removing designers for entry ${entryData.id}:`, e);
        });


        await this.repositoryManager.iterateAllEntries(async (entry: ArchiveEntry) => {
            if (entry.getData().id === entryData.id) {
                return;
            }

            // check references
            const otherData = entry.getData();
            const references = otherData.references;
            const authorReferences = otherData.author_references;

            const newReferences = references.filter(r => !(r.type === ReferenceType.ARCHIVED_POST && r.id === entryData.id));
            const newAuthorReferences = authorReferences.filter(r => !(r.type === ReferenceType.ARCHIVED_POST && r.id === entryData.id));
            const updated = newReferences.length !== references.length || newAuthorReferences.length !== authorReferences.length;
            otherData.references = newReferences;
            otherData.author_references = newAuthorReferences;

            if (updated && otherData.post) {
                await this.repositoryManager.addOrUpdateEntryFromData(otherData, otherData.post.forumId, false, false, async () => {
                    // do nothing
                }).catch(e => {
                    console.error("Error updating entry for URL update:", e);
                });
            }
        }).catch(e => {
            console.error("Error iterating all entries:", e);
        });

        // update definitions
        await this.getDictionaryManager().iterateEntries(async (definition) => {

            const newReferences = definition.references.filter(r => !(r.type === ReferenceType.ARCHIVED_POST && r.id === entryData.id));
            let updated = newReferences.length !== definition.references.length;
            const newReferencedBy = definition.referencedBy.filter(r => r !== entryData.id);
            if (newReferencedBy.length !== definition.referencedBy.length) {
                updated = true;
            }

            definition.references = newReferences;
            definition.referencedBy = newReferencedBy;

            if (updated) {
                await this.getDictionaryManager().saveEntry(definition);
                await this.getDictionaryManager().updateStatusMessage(definition).catch(e => {
                    console.error("Error updating definition status message:", e);
                });
            }
        });
    }

    public async updateDesignerRoles(entryId: Snowflake, oldAuthors: Author[], newAuthors: Author[]) {
        const designerRoleId = this.getConfigManager().getConfig(GuildConfigs.DESIGNER_ROLE_ID);
        if (!designerRoleId) {
            return;
        }

        const oldDesigners = oldAuthors.filter(a => a.type === AuthorType.DiscordInGuild && !a.dontDisplay) as DiscordAuthor[];
        const newDesigners = newAuthors.filter(a => a.type === AuthorType.DiscordInGuild && !a.dontDisplay) as DiscordAuthor[];

        const oldDesignerIds = oldDesigners.map(a => a.id);
        const newDesignerIds = newDesigners.map(a => a.id);

        const oldSet = new Set(oldDesignerIds);
        const newSet = new Set(newDesignerIds);


        const added = newSet.difference(oldSet);
        const removed = oldSet.difference(newSet);

        const idToUsernameMap = new Map<Snowflake, string>();
        oldDesigners.forEach(a => {
            idToUsernameMap.set(a.id, a.username);
        });
        newDesigners.forEach(a => {
            idToUsernameMap.set(a.id, a.username);
        });

        for (const designerId of added) {
            // get userdata for designer
            let userData = await this.userManager.getOrCreateUserData(designerId, idToUsernameMap.get(designerId) || 'Unknown');
            if (!userData.archivedPosts) {
                userData.archivedPosts = [];
            }
            if (!userData.archivedPosts.includes(entryId)) {
                userData.archivedPosts.push(entryId);
            }

            await this.userManager.saveUserData(userData);

            const member = await this.getGuild().members.fetch(designerId).catch(() => undefined);
            if (!member) {
                continue; // Skip if member not found
            }

            if (!member.roles.cache.has(designerRoleId)) {
                const designerRole = this.getGuild().roles.cache.get(designerRoleId);
                if (designerRole) {
                    await member.roles.add(designerRole).catch((_) => {
                        console.error(`[${this.getGuild().name}] Error adding designer role to user ${member.user.username}`);
                    });
                } else {
                    console.warn(`Designer role with ID ${designerRoleId} not found in guild ${this.getGuild().name}`);
                }
            }
        }

        for (const designerId of removed) {
            // get userdata for designer
            let userData = await this.userManager.getOrCreateUserData(designerId, idToUsernameMap.get(designerId) || 'Unknown');
            if (!userData.archivedPosts) {
                userData.archivedPosts = [];
            }
            userData.archivedPosts = userData.archivedPosts.filter(id => id !== entryId);

            await this.userManager.saveUserData(userData);

            const member = await this.getGuild().members.fetch(designerId).catch(() => undefined);
            if (!member) {
                continue; // Skip if member not found
            }
            if (member.roles.cache.has(designerRoleId) && userData.archivedPosts.length === 0) {
                const designerRole = this.getGuild().roles.cache.get(designerRoleId);
                if (designerRole) {
                    await member.roles.remove(designerRole).catch((_) => {
                        console.error(`[${this.getGuild().name}] Error removing designer role from user ${member.user.username}`);
                    });
                } else {
                    console.warn(`Designer role with ID ${designerRoleId} not found in guild ${this.getGuild().name}`);
                }
            }
        }
    }

    public async rebuildDesignerRoles() {
        const allDesignerIdsToPosts = new Map<Snowflake, Snowflake[]>();
        await this.getRepositoryManager().iterateAllEntries(async (entry: ArchiveEntry) => {
            entry.getData().authors.forEach(author => {
                if (author.type === AuthorType.DiscordInGuild && !author.dontDisplay && author.id) {
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
                        await member.roles.remove(designerRole).catch((_) => {
                            console.error(`[${this.getGuild().name}] Error removing designer role from user ${member.user.username}`);
                        });

                    } else {
                        console.warn(`Designer role with ID ${designerRoleId} not found in guild ${this.getGuild().name}`);
                    }
                } else if (designerRoleId && !member.roles.cache.has(designerRoleId) && posts.length > 0) {
                    const designerRole = this.getGuild().roles.cache.get(designerRoleId);
                    if (designerRole) {
                        await member.roles.add(designerRole).catch((_) => {
                            console.error(`[${this.getGuild().name}] Error adding designer role to user ${member.user.username}`);
                        });
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

        if (oldEntryData.images.length > 0 && oldEntryData.images[0].url) {
            embed.setThumbnail(oldEntryData.images[0].url);
        }

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

    public getSchema(): JSONSchema7 {
        return this.repositoryManager.getConfigManager().getConfig(RepositoryConfigs.POST_SCHEMA);
    }

    public getSchemaStyles(): Record<string, StyleInfo> {
        return this.repositoryManager.getConfigManager().getConfig(RepositoryConfigs.POST_STYLE);
    }

    public getUserManager(): UserManager {
        return this.userManager;
    }

    public getUserSubscriptionManager(): UserSubscriptionManager {
        return this.userSubscriptionManager;
    }

    public getChannelSubscriptionManager(): ChannelSubscriptionManager {
        return this.channelSubscriptionManager;
    }


    public canConverse() {
        return this.bot.xaiClient !== undefined;
    }

    public async respondToConversation(channel: TextChannel | TextThreadChannel, message: Message) {
        if (!this.bot.xaiClient) {
            throw new Error('LLM client not configured');
        }

        const channelName = channel.name;
        const channelTopic = channel.isThread() ? getCodeAndDescriptionFromTopic(channel.parent?.topic || '').description : (channel.topic ?? '');
        let contextLength;
        let model;
        let systemPrompt;
        const specialQuestions = ['who is right', 'is this true', 'translate'];
        if (specialQuestions.some(q => message.content.toLowerCase().includes(q))) {
            contextLength = 50; // more context for "who is right" questions
            model = this.bot.xaiClient("grok-4-1-fast-reasoning"); // use better model for complex questions
            systemPrompt = `You are LlamaBot, a helpful assistant that helps with Minecraft Discord server administration. The discord collects designs submitted by the community, and is open to the public. You are friendly and talk casually. You are logical and do not flatter. Use the tools available to you to answer user's questions, especially if they want recommendations for designs. NEVER use emojis or em-dashes. User mentions are in the format <@UserID> and will be prepended to messages they send. Mention the correct user to keep the conversation clear. EG: If a message says "<@123456789012345678> tell them" and a previous message from user 4987654321012345678 said "I love Minecraft", you should respond with "<@4987654321012345678> Minecraft is great!" Do not make up information. If you are unsure about something, say you don't know.`;
        } else {
            contextLength = 10;
            model = this.bot.xaiClient("grok-4-1-fast-reasoning"); // use faster model for normal questions
            systemPrompt = `You are LlamaBot, a helpful assistant that helps with Minecraft Discord server administration. The discord collects designs submitted by the community, and is open to the public. You are friendly, concise, and talk casually. Use the tools available to you to answer user's questions, especially if they want recommendations for designs. You are talking in a channel called #${channelName}.${channelTopic ? ` The channel topic is: ${channelTopic}.` : ''} Direct users to the appropriate channel if they ask where they can find a design, but otherwise do not recommend channels especially without using tools because you can't read the channels and you will be wrong. User mentions are in the format <@UserID> and will be prepended to messages they send. NEVER use emojis or em-dashes. Mention the correct user to keep the conversation clear. EG: If a message says "<@123456789012345678> tell them" and a previous message from user 4987654321012345678 said "I love Minecraft", you should respond with "<@4987654321012345678> Minecraft is great!" Do not make up information. If you are unsure about something, say you don't know.`;
        }

        // const allchannels = this.guild.channels.cache;
        // const channelText: string[] = [];
        // allchannels.forEach(channel => {
        //     if (channel && (channel.isTextBased() || channel.type === ChannelType.GuildForum) && !channel.isThread() && !channel.isVoiceBased()) {
        //         channelText.push(`#${channel.name}`);
        //     }
        // });

        // if (channelText.length > 0) {
        //     systemPrompt += `\nThe server has the following channels: ${channelText.join(', ')}.`;
        // }

        const messages = await channel.messages.fetch({ limit: contextLength });

        // Remove messages that are not in the last 24 hours
        // const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        //const recentMessages = messages.filter(msg => msg.createdTimestamp > oneDayAgo);

        // remove messages older than 10 minutes from the most recent message
        const mostRecentTimestamp = messages.reduce((max, msg) => Math.max(max, msg.createdTimestamp), 0);
        const tenMinutesAgo = mostRecentTimestamp - (10 * 60 * 1000);
        const relevantMessages = messages.filter(msg => msg.createdTimestamp >= tenMinutesAgo);
        // Sort messages so that newest is last
        const sortedMessages = relevantMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        

        const messagesIn: { mid: Snowflake, id: number, obj: ModelMessage }[] = [];

        //messagesIn.push({ mid: '0', id: 0, obj: { role: 'system', content: systemPrompt } });
        sortedMessages.forEach(msg => {
            const isBot = msg.author.id === this.getBot().client.user?.id;
            const role = isBot ? 'assistant' : 'user';
            const content = msg.content;
            // replace mentions with @username
            // const mentionRegex = /<@!?(\d+)>/g;
            const contentWithMentions = content;

            // if content length is greater than 1000, truncate it
            const maxLength = 1000;
            const truncatedContent = contentWithMentions.length > maxLength ? contentWithMentions.slice(0, maxLength) + '... (truncated)' : contentWithMentions;

            // check reply
            let replyTo = null;
            if (msg.reference && msg.reference.messageId) {
                const repliedMessage = messagesIn.find(m => m.mid === msg.reference?.messageId);
                if (repliedMessage) {
                    replyTo = repliedMessage.id;
                }
            }
            messagesIn.push({ mid: msg.id, id: messagesIn.length, obj: { role, content: `[${messagesIn.length}] <@${msg.author.id}> ${replyTo === null ? "said" : ` replied to [${replyTo}]`}: ${truncatedContent}` } });
        });

        const dictionaryEntriesRetrieved = new Set<Snowflake>();

        const tools: Record<string, Tool> = {
            search: {
                description: 'Lookup designs made by expert Minecraft redstone engineers using semantic search.',
                inputSchema: z.object({
                    query: z.string().min(1).max(256).describe('The search query to find relevant Minecraft redstone designs.'),
                }),
                outputSchema: zodSchema(
                    z.object({
                        results: z.array(z.object({
                            title: z.string().describe('The title of the design.'),
                            code: z.string().describe('The identifier code for the design.'),
                            authors: z.string().describe('The authors of the design.'),
                            tags: z.array(z.string()).describe('List of tags associated with the design.'),
                            description: z.string().describe('A description of the design.'),
                        })).describe('Top 5 list of Minecraft redstone designs matching the search query.'),
                        error: z.string().optional().describe('An error message, if an error occurred during the search.'),
                    })
                ),
                execute: async (input: { query: string }) => {
                    const queryEmbeddings = await generateQueryEmbeddings([input.query.trim()]).catch(e => {
                        console.error('Error generating query embeddings:', e);
                        return null;
                    });
                    if (!queryEmbeddings) {
                        return { results: [], error: 'Error generating query embeddings' };
                    }

                    try {
                        const queryEmbeddingVector = base64ToInt8Array(queryEmbeddings.embeddings[0]);
                        const closest = await this.repositoryManager.getClosest(queryEmbeddingVector, 5);
                        const results = [];
                        for (const result of closest) {
                            const entry = await this.repositoryManager.getEntryByPostCode(result.identifier);
                            if (entry) {
                                const data = entry.entry.getData();
                                // first entry
                                const text = transformOutputWithReferencesForEmbeddings(postToMarkdown(data.records, data.styles, this.getSchemaStyles()), data.references);
                                results.push({
                                    title: data.name,
                                    code: data.code,
                                    tags: data.tags.map(t => t.name),
                                    authors: data.authors.map(a => getAuthorName(a)),
                                    description: truncateStringWithEllipsis(text, 2000)
                                });
                            }
                        }
                        return { results };
                    } catch (e) {
                        console.error('Error during search execution:', e);
                        return { results: [], error: 'Error during search execution' };
                    }
                }
            },
            define: {
                description: 'Lookup Minecraft and redstone related terms from a custom dictionary of definitions.',
                inputSchema: z.object({
                    query: z.string().min(1).max(256).describe('The search query to find relevant Minecraft and redstone definitions.'),
                }),
                outputSchema: zodSchema(
                    z.object({
                        results: z.array(z.object({
                            terms: z.string().describe('The terms defined.'),
                            definition: z.string().describe('The definition.'),
                        })).describe('Top 5 list of definitions matching the search query.'),
                        error: z.string().optional().describe('An error message, if an error occurred during the search.'),
                    })
                ),
                execute: async (input: { query: string }) => {
                    const queryEmbeddings = await generateQueryEmbeddings([input.query.trim()]).catch(e => {
                        console.error('Error generating query embeddings:', e);
                        return null;
                    });
                    if (!queryEmbeddings) {
                        return { results: [], error: 'Error generating query embeddings' };
                    }

                    try {
                        const queryEmbeddingVector = base64ToInt8Array(queryEmbeddings.embeddings[0]);
                        const topResults = await this.getDictionaryManager().getClosest(queryEmbeddingVector, 5);
                        const results = [];
                        for (const result of topResults) {
                            const entry = await this.getDictionaryManager().getEntry(result.identifier);
                            if (entry) {
                                // first entry
                                const text = transformOutputWithReferencesForEmbeddings(entry.definition, entry.references);
                                results.push({
                                    terms: entry.terms.join(', '),
                                    definition: truncateStringWithEllipsis(text, 2000),
                                });
                                dictionaryEntriesRetrieved.add(entry.id);
                            }
                        }

                        return { results };
                    } catch (e) {
                        console.error('Error during define execution:', e);
                        return { results: [], error: 'Error during define execution' };
                    }
                }
            },
            channels: {
                description: 'Get more info about the server\'s channels to help direct users where they can find certain topics and designs. Use this if people ask where to find something.',
                inputSchema: z.object({}),
                outputSchema: zodSchema(
                    z.object({
                        channels: z.array(z.object({
                            name: z.string().describe('The name of the channel.'),
                            topic: z.string().describe('The topic of the channel.'),
                            isArchiveChannel: z.boolean().describe('Whether the channel is an archive channel containing redstone designs.'),
                        })).describe('List of channels in the server.'),
                    })
                ),
                execute: async (_input: {}) => {
                    const channels: { name: string; topic: string; isArchiveChannel: boolean }[] = [];
                    const archiveCategories = this.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS) || [];
                    const allchannels = this.guild.channels.cache;
                    allchannels.forEach(channel => {
                        if (channel && (channel.isTextBased() || channel.type === ChannelType.GuildForum) && !channel.isThread() && !channel.isVoiceBased()) {
                            channels.push({
                                name: channel.name,
                                topic: getCodeAndDescriptionFromTopic(channel.topic || '').description,
                                isArchiveChannel: archiveCategories.includes(channel.parentId || ''),
                            });
                        }
                    });
                    return { channels };
                }
            },
            warn_user: {
                description: 'Issue a warning to a user about their behavior. Use this when a user is being disruptive, spamming, or trying to make you say inappropriate things. With 3 warnings, they will not be allowed to talk to you anymore for a month.',
                inputSchema: z.object({
                    user_id: z.string().describe('The Discord user ID of the user to warn.'),
                    reason: z.string().describe('The reason for the warning.'),
                }),
                outputSchema: zodSchema(
                    z.object({
                        success: z.boolean().describe('Whether the warning was successfully issued.'),
                        numWarnings: z.number().describe('The number of warnings the user has received. Mention this in your response to help the moderators decide on further action.'),
                        error: z.string().optional().describe('An error message, if an error occurred while issuing the warning.'),
                    })
                ),
                execute: async (input: { user_id: string; reason: string }) => {
                    try {
                        const member = await this.guild.members.fetch(input.user_id).catch(() => undefined);
                        if (!member) {
                            return { success: false, numWarnings: 0, error: 'User not found in guild' };
                        }

                        const userData = await this.userManager.getOrCreateUserData(input.user_id, 'Unknown');
                        if (!userData.llmWarnings) {
                            userData.llmWarnings = [];
                        }

                        userData.llmWarnings.push({
                            messageId: message.id,
                            timestamp: Date.now(),
                            reason: input.reason,
                        });

                        await this.userManager.saveUserData(userData);

                        return { success: true, numWarnings: userData.llmWarnings.filter(w => (Date.now() - w.timestamp) < (30 * 24 * 60 * 60 * 1000)).length };
                    } catch (e) {
                        console.error('Error issuing warning to user:', e);
                        return { success: false, numWarnings: 0, error: 'Error issuing warning to user' };
                    }
                }
            }
        };

        if (this.privateFactBase.isFactBaseEnabled()) {
            tools.facts = {
                description: 'Lookup information from the private fact database. This is the largest resource. Use this resource frequently to understand comprehensive knowledge about Minecraft, redstone, and common community practices. Always check this before making recommendations.',
                inputSchema: z.object({
                    query: z.string().min(1).max(256).describe('The search query to find relevant factsheet information.'),
                }),
                outputSchema: zodSchema(
                    z.object({
                        results: z.array(z.object({
                            content: z.string().describe('The content of the factsheet.'),
                        })).describe('Top 5 list of factsheet entries matching the search query.'),
                        error: z.string().optional().describe('An error message, if an error occurred during the search.'),
                    })
                ),
                execute: async (input: { query: string }) => {
                    // console.log('Executing factsheet tool with query:', input.query);
                    const queryEmbeddings = await generateQueryEmbeddings([input.query.trim()]).catch(e => {
                        console.error('Error generating query embeddings:', e);
                        return null;
                    });
                    if (!queryEmbeddings) {
                        return { results: [], error: 'Error generating query embeddings' };
                    }
                    try {
                        const queryEmbeddingVector = base64ToInt8Array(queryEmbeddings.embeddings[0]);
                        const results = await this.privateFactBase.getClosest(queryEmbeddingVector, 5);
                        const data = [];
                        for (const result of results) {
                            const sheet = await this.privateFactBase.getFact(result.identifier);
                            if (sheet) {
                                const text = sheet.text.replace(/\[QA\d+\]/g, '').trim();
                                data.push({
                                    content: sheet.page_title ? `# ${sheet.page_title}\n\n${text}` : text,
                                });
                            }
                        }
                        return { results: data };
                    } catch (e) {
                        console.error('Error during factsheet query execution:', e);
                        return { results: [], error: 'Error during factsheet query execution' };
                    }
                }
            }
        }

        const response = await generateText({
            model: model,
            system: systemPrompt,
            messages: messagesIn.map(m => m.obj),
            stopWhen: stepCountIs(20),
            output: Output.object(
                {
                    schema: zodSchema(
                        z.object({
                            response_text: z.string().optional().describe('The raw text of the response to be sent in the Discord channel. Optional, may be empty if no response is needed. You can use markdown formatting here, but tables are not supported.'),
                        })
                    ),
                }
            ),
            tools: tools
        })

        if (response.warnings?.length) {
            console.warn('LLM Warnings:', response.warnings);
        }

        if (!response.output) {
            console.error('No response from LLM:', response.output);
            throw new Error('No response from LLM');
        }

        // replace @username with actual mentions if possible
        let responseText = response.output.response_text || '';

        if (!responseText) {
            return '';
        }

        // Check for channel name mentions eg #ask-questions
        const channelMentionRegex = /#(\S+)/g;
        let match;
        while ((match = channelMentionRegex.exec(responseText)) !== null) {
            const channelName = match[1];
            const foundChannel = this.guild.channels.cache.find(c => c.name.replace(/[^a-zA-Z0-9]/g, '') === channelName.replace(/[^a-zA-Z0-9]/g, '') && (c.isTextBased() || c.type === ChannelType.GuildForum) && !c.isThread() && !c.isVoiceBased());
            if (foundChannel) {
                responseText = responseText.replaceAll(`#${channelName}`, `<#${foundChannel.id}>`);
            }
        }


        // remove everyone mentions
        responseText = responseText.replace(/@everyone/g, 'everyone');
        responseText = responseText.replace(/@here/g, 'here');

        // Sometimes, the llm will respond with "[n] @LlamaBot said: blabla" or "[n] @LlamaBot replied to [m]: blabla" so we remove that
        const botMentionRegex = /(\[\d+\])*\s*<@!?(\d+)>\s+(said|replied to \[\d+\]):\s+/g;
        responseText = responseText.replace(botMentionRegex, '');

        const citationRegex = /Citations?:\s*(\d+,?\S*)*/gi;
        responseText = responseText.replace(citationRegex, '');

        responseText.replace(/\[\d{17,19}\]/g, ''); // remove reference numbers

        responseText = responseText.trim();

    

        const inTextReferences: Reference[] = await tagReferences(responseText, [], this, '', false);
        const filteredReferences = inTextReferences.filter(ref => {
            if (ref.type === ReferenceType.ARCHIVED_POST) {
                return false;
            }
            if (ref.type === ReferenceType.DICTIONARY_TERM) {
                return dictionaryEntriesRetrieved.has(ref.id);
            }
            return true;
        });

        responseText = transformOutputWithReferencesForDiscord(responseText, filteredReferences);

        const references = await this.getReferenceEmbedsFromMessage(responseText, true, true, 10);
        const split = splitIntoChunks(responseText, 2000);

        for (let i = 0; i < split.length; i++) {
            if (i === 0) {
                await message.reply({ content: split[i], allowedMentions: { parse: [] }, flags: [MessageFlags.SuppressNotifications, MessageFlags.SuppressEmbeds] }).catch(console.error);
            } else {
                await channel.send({ content: split[i], allowedMentions: { parse: [] }, flags: [MessageFlags.SuppressNotifications, MessageFlags.SuppressEmbeds] }).catch(console.error);
            }
        }
        if (references.length > 0) {
            for (const embed of references) {
                await channel.send({
                    embeds: [embed],
                    flags: [MessageFlags.SuppressNotifications],
                    allowedMentions: { parse: [] },
                }).catch(console.error);
            }
        }
    }

    public getAliasManager() {
        return this.aliasManager;
    }

    public getFactManager() {
        return this.privateFactBase;
    }
}
