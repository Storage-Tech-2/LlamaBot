import { ChannelType, ChatInputCommandInteraction, Client, Events, GatewayIntentBits, Message, Partials, SelectMenuInteraction, Snowflake, TextChannel, TextThreadChannel } from "discord.js";
import { GuildHolder } from "./GuildHolder.js";
import { LLMQueue } from "./llm/LLMQueue.js";
import path from "path";
import fs from "fs/promises";
import { Command } from "./interface/Command.js";
import { Button } from "./interface/Button.js";
import { Menu } from "./interface/Menu.js";
import { Modal } from "./interface/Modal.js";
import { deployCommands, getCodeAndDescriptionFromTopic, getItemsFromArray, replyEphemeral } from "./utils/Util.js";
import { getButtons } from "./components/buttons/index.js";
import { getCommands } from "./commands/index.js";
import { getMenus } from "./components/menus/index.js";
import { getModals } from "./components/modals/index.js";
import { TempDataStore } from "./utils/TempDataStore.js";
import { App } from "octokit";
import { createXai, XaiProvider } from "@ai-sdk/xai";
import { generateText, LanguageModel, ModelMessage } from "ai";
/**
 * The Secrets type defines the structure for the bot's secrets, including the token and client ID.
 */
export type Secrets = {
    token: string;
    clientId: string;
    githubAppId: string;
    xaiApiKey?: string;
}

/**
 * The Bot class is responsible for managing the Discord bot's lifecycle across multiple guilds.
 */
export class Bot {
    /**
     * A map of guild IDs to GuildHolder instances, which manage the state and interactions for each guild.
     */
    guilds: Map<string, GuildHolder>;

    /**
      * The discord.js Client instance used to interact with the Discord API.
      */
    client: Client;

    /**
     * The LLM request queue, which holds requests to be processed by the LLM.
     */
    llmQueue: LLMQueue;

    /**
     * Commands available for the bot, loaded from the commands directory.
     */
    commands: Map<string, Command>;

    /**
     * Buttons available for the bot, loaded from the buttons directory.
     */
    buttons: Map<string, Button>;

    /**
     * Menus available for the bot, loaded from the menus directory.
     */
    menus: Map<string, Menu>;

    /**
     * Modals available for the bot, loaded from the modals directory.
     */
    modals: Map<string, Modal>;

    /**
     * Indicates whether the bot is ready and connected to Discord.
     */
    ready: boolean = false;

    /**
     * Temp data store
     */
    tempData: TempDataStore;

    /**
     * Github client
     */
    githubClient?: App;

    /**
     * Xai bot client
     */
    paidLlmModel?: XaiProvider;


    constructor() {
        this.guilds = new Map()
        this.llmQueue = new LLMQueue()
        this.commands = new Map()
        this.buttons = new Map()
        this.menus = new Map()
        this.modals = new Map()
        this.tempData = new TempDataStore();

        this.client = new Client({
            intents: [
                GatewayIntentBits.DirectMessages,
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildModeration
            ],
            partials: [
                Partials.Channel,
                Partials.Message,
                Partials.Reaction
            ]
        });
    }

    async start() {
        const secretsPath = path.join(process.cwd(), 'secrets.json')
        const secrets = JSON.parse(await fs.readFile(secretsPath, 'utf-8')) as Secrets
        if (!secrets.token || !secrets.clientId) {
            throw new Error('Missing token or clientId in secrets.json')
        }

        this.commands = getItemsFromArray(getCommands())
        this.buttons = getItemsFromArray(getButtons())
        this.menus = getItemsFromArray(getMenus());
        this.modals = getItemsFromArray(getModals());

        this.setupListeners(secrets)
        this.client.login(secrets.token)


        this.githubClient = new App({
            appId: secrets.githubAppId,
            privateKey: await fs.readFile(path.join(process.cwd(), 'key.pem'), 'utf-8'),
        });

        if (secrets.xaiApiKey) {
            const xaiClient = createXai({
                apiKey: secrets.xaiApiKey
            });
            // const model = xaiClient("grok-3-mini");
            this.paidLlmModel = xaiClient;
        }

        return new Promise((resolve, reject) => {
            this.client.once('ready', async () => {
                this.ready = true

                const guilds = await Promise.all((await this.client.guilds.fetch()).map((guild) => guild.fetch()))
                guilds.forEach((guild) => {
                    const holder = new GuildHolder(this, guild);
                    this.guilds.set(guild.id, holder);
                    deployCommands(this.commands, holder, secrets)
                })

                this.loop()

                console.log('Bot is ready')
                resolve(this)
            })

            this.client.once('error', (err) => {
                console.error('Error starting bot:', err)
                reject(err)
            })
        })
    }

    setupListeners(secrets: Secrets) {
        this.client.on(Events.GuildCreate, (guild) => {
            console.log(`Joined guild: ${guild.name} (${guild.id})`)
            const holder = this.guilds.get(guild.id) ?? new GuildHolder(this, guild);
            this.guilds.set(guild.id, holder);
            deployCommands(this.commands, holder, secrets)
        })

        this.client.on(Events.GuildDelete, (guild) => {
            console.log(`Left guild: ${guild.name} (${guild.id})`)
            this.guilds.delete(guild.id)
        })

        this.client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.inGuild()) {
                replyEphemeral(interaction, 'Cannot use outside of guild!')
                return;
            }

            const guildHolder = this.guilds.get(interaction.guildId)
            if (!guildHolder) {
                replyEphemeral(interaction, 'Guild not found!')
                return;
            }

            if (interaction.isCommand()) {
                const command = this.commands.get(interaction.commandName)
                if (!command) return

                try {
                    await command.execute(guildHolder, interaction as ChatInputCommandInteraction)
                } catch (error) {
                    console.error(error)
                    return replyEphemeral(interaction, 'An error occurred while executing the command.')
                }
            } else if (interaction.isButton()) {
                const customId = interaction.customId.split('|')
                const button = this.buttons.get(customId[0])
                if (!button) return

                try {
                    await button.execute(guildHolder, interaction, ...customId.slice(1))
                } catch (error) {
                    console.error(error)
                    return replyEphemeral(interaction, 'An error occurred while executing the button.')
                }
            } else if (interaction.isAnySelectMenu()) {
                const customId = interaction.customId.split('|')
                const menu = this.menus.get(customId[0])
                if (!menu) return

                try {
                    await menu.execute(guildHolder, interaction as SelectMenuInteraction, ...customId.slice(1))
                } catch (error) {
                    console.error(error)
                    return replyEphemeral(interaction, 'An error occurred while executing the menu.')
                }
            } else if (interaction.isModalSubmit()) {
                const customId = interaction.customId.split('|')
                const modal = this.modals.get(customId[0])
                if (!modal) return

                try {
                    await modal.execute(guildHolder, interaction, ...customId.slice(1))
                } catch (error) {
                    console.error(error)
                    return replyEphemeral(interaction, 'An error occurred while executing the modal.')
                }
            } else {
                return replyEphemeral(interaction, 'Unknown interaction type!')
            }
        })

        this.client.on(Events.MessageCreate, async (message) => {
            if (message.partial) {
                await message.fetch()
                    .catch(error => {
                        console.log('Something went wrong when fetching the message: ', error);
                    });
            }

            if (message.author.bot) return
            if (!message.inGuild()) {
                await this.handleAdminMessage(message)
                return
            }

            const guildHolder = this.guilds.get(message.guildId)
            if (!guildHolder) return

            // Handle message in guild
            try {
                await guildHolder.handleMessage(message)
            } catch (error) {
                console.error('Error handling message:', error)
            }
        })


        this.client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
            if (newMessage.partial) {
                await newMessage.fetch()
                    .catch(error => {
                        console.log('Something went wrong when fetching the message: ', error);
                    });
            }

            if (newMessage.author.bot) return
            if (!oldMessage.inGuild() || !newMessage.inGuild()) return

            const guildHolder = this.guilds.get(newMessage.guildId)
            if (!guildHolder) return

            // Handle message in guild
            try {
                await guildHolder.handleMessageUpdate(oldMessage, newMessage)
            } catch (error) {
                console.error('Error handling message update:', error)
            }
        });


        this.client.on(Events.MessageDelete, async (message) => {
            if (!message.inGuild()) return

            const guildHolder = this.guilds.get(message.guildId)
            if (!guildHolder) return

            // Handle message in guild
            try {
                await guildHolder.handleMessageDelete(message)
            } catch (error) {
                console.error('Error handling message delete:', error)
            }
        })

        this.client.on(Events.ThreadDelete, async (thread) => {
            if (!thread.isTextBased()) return


            const guildHolder = this.guilds.get(thread.guildId)
            if (!guildHolder) return

            // Handle message in guild
            try {
                await guildHolder.handleThreadDelete(thread)
            } catch (error) {
                console.error('Error handling thread delete:', error)
            }
        })

        this.client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
            if (!newThread.isTextBased()) return

            const guildHolder = this.guilds.get(newThread.guildId)
            if (!guildHolder) return

            // Handle message in guild
            try {
                await guildHolder.handleThreadUpdate(oldThread, newThread)
            } catch (error) {
                console.error('Error handling thread update:', error)
            }
        });

        this.client.on('error', (error) => {
            console.error('Discord client error:', error)
        })
    }

    async loop() {
        if (!this.ready) {
            console.error('Bot is not ready')
            return
        }

        for (const guildHolder of this.guilds.values()) {
            await guildHolder.loop()
        }

        setTimeout(() => this.loop(), 1000)
    }

    public getTempDataStore(): TempDataStore {
        return this.tempData;
    }

    /**
     * Get the Github installation token for an organization.
     * @param orgId The ID of the organization.
     */
    public async getGithubInstallationToken(orgId: string): Promise<string> {
        const installations: { access_tokens_url: any; }[] = [];
        await this.githubClient?.eachInstallation(({ installation }) => {
            if (installation.account?.login === orgId) {
                installations.push(installation);
            }
        });

        if (installations.length === 0) {
            throw new Error(`No GitHub installation found for organization ${orgId}`);
        }

        const url = installations[0].access_tokens_url;

        const response = await this.githubClient?.octokit.request('POST ' + url, {
            headers: {
                'Accept': 'application/vnd.github+json',
            }
        });

        if (!response || !response.data || !response.data.token) {
            throw new Error(`Failed to get GitHub installation token for organization ${orgId}`);
        }
        return response.data.token;
    }

    public async handleAdminMessage(message: Message) {
        // Check if dm and author is `239078039831445504`
        console.log(`Received admin message: ${message.content} from ${message.author.tag} (${message.author.id})`);
        if (message.inGuild()) return;
        if (message.author.id !== '239078039831445504') return;

        // Check if the message starts with `/`
        if (!message.content.startsWith('/')) {
            return message.reply('Please start your command with `/`');
        }

        // Split the message into command and args
        const args = message.content.slice(1).trim().split(/ +/);
        const commandName = args.shift()?.toLowerCase();
        if (!commandName) {
            return message.reply('Please provide a command.');
        }

        // Check if its refresh
        if (commandName === 'pull') {

            await message.reply('Running git pull...');
            try {
                await fs.access(path.join(process.cwd(), '.git'));
                const { exec } = await import('child_process');
                exec('git pull', { cwd: process.cwd() }, async (error, stdout, _stderr) => {
                    if (error) {
                        console.error(`Error pulling changes: ${error.message}`);
                        return message.reply(`Error pulling changes: ${error.message}`);
                    }
                    console.log(`Git pull output: ${stdout}`);
                    return message.reply('Bot refreshed successfully!');
                });
            } catch (err) {
                console.error('Not a git repository:', err);
                return message.reply('Not a git repository. Cannot refresh.');
            }
        } else {
            return message.reply(`Unknown command: ${commandName}`);
        }
    }

    public async canConverse() {
        return this.paidLlmModel !== undefined;
    }

    public async respondToConversation(channel: TextChannel | TextThreadChannel, message: Message): Promise<string> {
        if (!this.paidLlmModel) {
            throw new Error('LLM client not configured');
        }

        const channelName = channel.name;
        const channelTopic = channel.isThread() ? getCodeAndDescriptionFromTopic(channel.parent?.topic || '').description : (channel.topic ?? '');
        let contextLength;
        let model;
        let systemPrompt;
        let maxOutputLength;
        const specialQuestions = ['who is right', 'is this true', 'translate into'];
        if (specialQuestions.some(q => message.content.toLowerCase().includes(q))) {
            contextLength = 50; // more context for "who is right" questions
            model = this.paidLlmModel("grok-4"); // use better model for complex questions
            systemPrompt = `You are LlamaBot, a helpful assistant that helps with Minecraft Discord server administration. You are friendly and talk casually. You are logical and do not flatter. User mentions are in the format <@UserID> and will be prepended to messages they send. Do not use emojis or em-dashes. Mention the correct user to keep the conversation clear. EG: If a message says "<@123456789012345678> tell them" and a previous message from user 4987654321012345678 said "I love Minecraft", you should respond with "<@4987654321012345678> Minecraft is great!"`;
            maxOutputLength = 20000;
        } else {
            contextLength = 10;
            model = this.paidLlmModel("grok-3-mini");

            // get channel list
            const channelList = channel.guild.channels.cache
                .filter(c => (c.isTextBased() || c.type === ChannelType.GuildForum) && !c.isThread() && !c.isVoiceBased())
                .filter(c => c.permissionsFor(channel.guild.roles.everyone).has('ViewChannel'))
                .map(c => {
                    let topic = c.topic ? getCodeAndDescriptionFromTopic(c.topic || "").description : "No topic";
                    return `#${c.name} - ${topic}`;
                })
                .join(', ');

            systemPrompt = `You are LlamaBot, a helpful assistant that helps with Minecraft Discord server administration and development. You are friendly, concise, and talk casually. You are talking in a channel called #${channelName}.${channelTopic ? ` The channel topic is: ${channelTopic}.` : ''} Direct users to the appropriate channel if they ask where they can find something. Available channels: ${channelList}. User mentions are in the format <@UserID> and will be prepended to messages they send. Do not use emojis or em-dashes. Mention the correct user to keep the conversation clear. EG: If a message says "<@123456789012345678> tell them" and a previous message from user 4987654321012345678 said "I love Minecraft", you should respond with "<@4987654321012345678> Minecraft is great!"`;
            maxOutputLength = 1000;
        }
        const messages = await channel.messages.fetch({ limit: contextLength });

        // Remove messages that are not in the last 24 hours
        // const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        //const recentMessages = messages.filter(msg => msg.createdTimestamp > oneDayAgo);

        // Sort messages so that newest is last
        const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        const messagesIn: { mid: Snowflake, id: number, obj: ModelMessage }[] = [];

        messagesIn.push({ mid: '0', id: 0, obj: { role: 'system', content: systemPrompt } });
        sortedMessages.forEach(msg => {
            const isBot = msg.author.id === this.client.user?.id;
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

        const response = await generateText({
            model: model,
            messages: messagesIn.map(m => m.obj),
            maxOutputTokens: maxOutputLength,
        })

        if (response.warnings?.length) {
            console.warn('LLM Warnings:', response.warnings);
        }

        if (!response.text) {
            //console.error('No response from LLM:', response);
            throw new Error('No response from LLM');
        }

        // replace @username with actual mentions if possible
        let responseText = response.text;

        // Check for channel name mentions eg #ask-questions
        const channelMentionRegex = /#([a-zA-Z0-9-_]+)/g;
        let match;
        while ((match = channelMentionRegex.exec(responseText)) !== null) {
            const channelName = match[1];
            const foundChannel = channel.guild.channels.cache.find(c => c.name === channelName && (c.isTextBased() || c.type === ChannelType.GuildForum) && !c.isThread());
            if (foundChannel) {
                responseText = responseText.replace(`#${channelName}`, `<#${foundChannel.id}>`);
            }
        }

        // remove everyone mentions
        responseText = responseText.replace(/@everyone/g, 'everyone');
        responseText = responseText.replace(/@here/g, 'here');

        // Sometimes, the llm will respond with "[n] @LlamaBot said: blabla" or "[n] @LlamaBot replied to [m]: blabla" so we remove that
        const botMentionRegex = /\[\d+\]\s+<@!?(\d+)>\s+(said|replied to \[\d+\]):\s+/g;
        responseText = responseText.replace(botMentionRegex, '');

        return responseText;
    }
}
