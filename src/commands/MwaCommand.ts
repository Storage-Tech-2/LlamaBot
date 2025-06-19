import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, InteractionContextType, ChannelType, ActionRowBuilder, ForumChannel, GuildForumTag, ForumLayoutType, SortOrderType, Snowflake } from "discord.js";
import { GuildHolder } from "../GuildHolder";
import { Command } from "../interface/Command";
import { getCodeAndDescriptionFromTopic, replyEphemeral } from "../utils/Util";
import { GuildConfigs } from "../config/GuildConfigs";
import { SetArchiveCategoriesMenu } from "../components/menus/SetArchiveCategoriesMenu";
import { SetEndorseRolesMenu } from "../components/menus/SetEndorseRolesMenu";
import { SubmissionTags } from "../submissions/SubmissionTags";

export class Mwa implements Command {
    getID(): string {
        return "mwa";
    }

    getBuilder(): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data
            .setName('mwa')
            .setDescription('Llamabot setup for administrators')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .setContexts(InteractionContextType.Guild)
            .addSubcommand(subcommand =>
                subcommand
                    .setName('setsubmissions')
                    .setDescription('Setup Llamabot to listen to a channel')
                    .addChannelOption(option =>
                        option
                            .setName('channel')
                            .setDescription('Channel to listen to')
                            .setRequired(true)
                            .addChannelTypes(ChannelType.GuildForum)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('setlogs')
                    .setDescription('Setup Llamabot to send update logs to a channel')
                    .addChannelOption(option =>
                        option
                            .setName('channel')
                            .setDescription('Channel to send update logs to')
                            .setRequired(true)
                            .addChannelTypes(ChannelType.GuildText)
                    )
            )
             .addSubcommand(subcommand =>
                subcommand
                    .setName('setendorseroles')
                    .setDescription('Setup Llamabot endorse roles')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('setarchives')
                    .setDescription('Setup archive channels for Llamabot')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('setuparchives')
                    .setDescription('Setup forums for archive channels')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('setrepo')
                    .setDescription('Set the GitHub repository for the archive')
                    .addStringOption(option =>
                        option
                            .setName('url')
                            .setDescription('GitHub repository URL')
                            .setRequired(true)
                    )
            )
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (interaction.options.getSubcommand() === 'setsubmissions') {
            this.setSubmissions(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'setarchives') {
            this.setArchives(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'setlogs') {
            this.setLogs(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'setuparchives') {
            this.setupArchives(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'setendorseroles') {
            this.setEndorseRoles(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'setrepo') {
            this.setRepo(guildHolder, interaction)
        }
    }

    async setRepo(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const url = interaction.options.getString('url')

        if (!url) {
            await replyEphemeral(interaction, 'Invalid URL')
            return
        }

        guildHolder.getConfigManager().setConfig(GuildConfigs.GITHUB_REPO_URL, url)
        await replyEphemeral(interaction, `Successfully set Git repository URL to ${url} and token!`);
        interaction.followUp({
            content: `<@${interaction.user.id}> Set the Git repository to ${url}!`,
        });

        try {
            await guildHolder.getRepositoryManager().setRemote(url)
        } catch (error) {
            console.error('Error setting remote repository:', error)
            await replyEphemeral(interaction, 'Error setting remote repository. Please check the URL and try again.')
            return
        }
    }

    async setSubmissions(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const channel = interaction.options.getChannel('channel')
        if (!channel) {
            await replyEphemeral(interaction, 'Invalid channel')
            return
        }

        guildHolder.getConfigManager().setConfig(GuildConfigs.SUBMISSION_CHANNEL_ID, channel.id)
        await replyEphemeral(interaction, `Llamabot will now listen to ${channel.name} for submissions!`);
    }

    async setArchives(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        // Get all channels in the guild
        const currentCategories = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS);
        const dt = await (new SetArchiveCategoriesMenu()).getBuilder(guildHolder, currentCategories);
        const row = new ActionRowBuilder()
            .addComponents(dt);
        // interaction.reply({ content: `Change notification settings of '${name}' in this channel`, components: [row], ephemeral: true })
        await replyEphemeral(interaction, 'Select archive categories', { components: [row] })
    }

     async setEndorseRoles(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const dt = await (new SetEndorseRolesMenu()).getBuilder(guildHolder);
        const row = new ActionRowBuilder()
            .addComponents(dt);
        await replyEphemeral(interaction, 'Select endorsement roles', { components: [row] })
    }

    async setLogs(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const channel = interaction.options.getChannel('channel')
        if (!channel) {
            await replyEphemeral(interaction, 'Invalid channel')
            return
        }

        guildHolder.getConfigManager().setConfig(GuildConfigs.LOGS_CHANNEL_ID, channel.id)
        await replyEphemeral(interaction, `Llamabot will now send updates to ${channel.name}!`);
    }


    async setupArchives(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        if (!interaction.channel || !interaction.channel.isTextBased() || !interaction.inGuild()) {
            await replyEphemeral(interaction, 'This command can only be used in a text channel.')
            return;
        }

        // Setup submission channel
        const submissionChannelId = guildHolder.getConfigManager().getConfig(GuildConfigs.SUBMISSION_CHANNEL_ID);
        if (!submissionChannelId) {
            await replyEphemeral(interaction, 'Submission channel is not set. Please set it using `/mwa setsubmissions` command.');
            return;
        }

        const submissionChannel = await guildHolder.getGuild().channels.fetch(submissionChannelId);
        if (!submissionChannel || submissionChannel.type !== ChannelType.GuildForum) {
            await replyEphemeral(interaction, 'Submission channel is not a valid forum channel. Please set it using `/mwa setsubmissions` command.');
            return;
        }

        const tags = submissionChannel.availableTags.filter(tag => {
                return !SubmissionTags.some(t => t.name === tag.name)
        })
        const newTags = SubmissionTags.concat(tags);
        await submissionChannel.setAvailableTags(newTags);
        await submissionChannel.setDefaultReactionEmoji({
            name: '👍',
            id: null
        });
        
        const currentCategories = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS);
        // get all channels in categories
        const allchannels = await guildHolder.getGuild().channels.fetch()
        const channels = allchannels.filter(channel => {
            return channel && channel.type === ChannelType.GuildForum && channel.parentId && currentCategories.includes(channel.parentId)
        }) as unknown as ForumChannel[];

        const basicTags: GuildForumTag[] = [
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
                name: 'Quite Novel',
                emoji: { name: '😋' },
                moderated: true
            },
            {
                name: 'A+ Excellent',
                emoji: { name: '⭐' },
                moderated: true
            }
        ] as GuildForumTag[];
        // check each channel

        await interaction.deferReply()
        const codeMap = new Map<Snowflake, string>();
        for (const channel of channels.values()) {
            const tags = channel.availableTags.filter(tag => {
                return !basicTags.some(t => t.name === tag.name)
            })
            const newTags = basicTags.concat(tags)
            await channel.setAvailableTags(newTags)
            await channel.setDefaultReactionEmoji({ 
                name: '👍',
                id: null
            })
            await channel.setDefaultForumLayout(ForumLayoutType.GalleryView)
            await channel.setDefaultSortOrder(SortOrderType.CreationDate)

            // check if topic exists
            if (channel.topic) {
                const {code} = getCodeAndDescriptionFromTopic(channel.topic);
                if (code) {
                    codeMap.set(channel.id, code);
                }
            } else {
                interaction.editReply(`Error: Channel ${channel.name} does not have a topic set. Please set the topic to include a code in the format "Code: <code>"`)
                return;
            }
        }
        
      
        // Check if codemap has duplicates
        const codes = Array.from(codeMap.values());
        const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);
        if (duplicates.length > 0) {
            await interaction.editReply(`Error: The following codes are duplicated across channels: ${duplicates.join(', ')}`);
            return;
        }

        // Print each channel and its code
        let response = 'Channel codes:\n';
        codeMap.forEach((code, channelId) => {
            const channel = guildHolder.getGuild().channels.cache.get(channelId);
            if (channel) {
                response += `- ${channel.name}: ${code}\n`;
            } else {
                response += `- Channel with ID ${channelId} not found.\n`;
            }
        });
        await interaction.channel.send(response);

        try {
            await guildHolder.getRepositoryManager().setupArchives(channels)
        } catch (error) {
            console.error('Error setting up archives:', error);
            await interaction.channel.send('An error occurred while setting up archives. Please check the console for details.');
            return;
        }

        await interaction.editReply('Archives setup complete! Please check the channels for the new tags and settings.');
    }
}