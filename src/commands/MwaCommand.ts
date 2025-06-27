import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, InteractionContextType, ChannelType, ActionRowBuilder, ForumChannel, GuildForumTag, ForumLayoutType, SortOrderType, Snowflake, CategoryChannel } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { areAuthorsSame, getAuthorFromIdentifier, getAuthorsString, getCodeAndDescriptionFromTopic, replyEphemeral, splitIntoChunks } from "../utils/Util.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { SetArchiveCategoriesMenu } from "../components/menus/SetArchiveCategoriesMenu.js";
import { SetEndorseRolesMenu } from "../components/menus/SetEndorseRolesMenu.js";
import { SubmissionTags } from "../submissions/SubmissionTags.js";
import { SetEditorRolesMenu } from "../components/menus/SetEditorRolesMenu.js";
import { SetHelperRoleMenu } from "../components/menus/SetHelperRoleMenu.js";

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
                            .addChannelTypes(ChannelType.GuildAnnouncement, ChannelType.GuildText)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('setendorseroles')
                    .setDescription('Setup Llamabot endorse roles')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('seteditorroles')
                    .setDescription('Setup Llamabot editor roles')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('sethelperrole')
                    .setDescription('Setup Llamabot helper role')
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
                    .setName('makeindex')
                    .setDescription('Make an index of all archive channels')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('blacklistadd')
                    .setDescription('Add a user to the do-not-archive list')
                    .addStringOption(option =>
                        option
                            .setName('user')
                            .setDescription('User name or id to add to the do-not-archive list')
                            .setRequired(true)
                    )
                    .addStringOption(option =>
                        option
                            .setName('reason')
                            .setDescription('Reason for blacklisting the user')
                            .setRequired(false)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('blacklistremove')
                    .setDescription('Remove a user from the do-not-archive list')
                    .addStringOption(option =>
                        option
                            .setName('user')
                            .setDescription('User name or id to remove from the do-not-archive list')
                            .setRequired(true)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('blacklistlist')
                    .setDescription('List all users in the do-not-archive list')
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

            .addSubcommand(subcommand =>
                subcommand
                    .setName('republisheverything')
                    .setDescription('Republish all posts in the archive')
                    .addBooleanOption(option =>
                        option
                            .setName('silent')
                            .setDescription('Whether to suppress archive update messages')
                            .setRequired(true)
                    )
                    .addBooleanOption(option =>
                        option
                            .setName('replace')
                            .setDescription('Force remaking each thread for image reprocessing')
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('closeposts')
                    .setDescription('Close all open threads in the archive')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('closesubmissions')
                    .setDescription('Close all open threads in submissions')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('updatesubmissionsstatus')
                    .setDescription('Update the status of all submissions based on their archive status')
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
        } else if (interaction.options.getSubcommand() === 'seteditorroles') {
            this.setEditorRoles(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'sethelperrole') {
            this.setHelperRole(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'setrepo') {
            this.setRepo(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'makeindex') {
            this.makeIndex(guildHolder, interaction);
        } else if (interaction.options.getSubcommand() === 'blacklistadd') {
            this.addToBlacklist(guildHolder, interaction);
        } else if (interaction.options.getSubcommand() === 'blacklistremove') {
            this.removeFromBlacklist(guildHolder, interaction);
        } else if (interaction.options.getSubcommand() === 'blacklistlist') {
            this.listBlacklist(guildHolder, interaction);
        } else if (interaction.options.getSubcommand() === 'republisheverything') {
            this.republishEverything(guildHolder, interaction);
        } else if (interaction.options.getSubcommand() === 'closeposts') {
            this.closeEverythingPosts(guildHolder, interaction);
        } else if (interaction.options.getSubcommand() === 'closesubmissions') {
            this.closeEverythingSubmissions(guildHolder, interaction);
        } else if (interaction.options.getSubcommand() === 'updatesubmissionsstatus') {
            this.updateAllSubmissionsStatus(guildHolder, interaction);
        } else {
            await replyEphemeral(interaction, 'Invalid subcommand. Use `/mwa setsubmissions`, `/mwa setlogs`, `/mwa setarchives`, `/mwa setuparchives`, `/mwa setendorseroles`, `/mwa seteditorroles`, `/mwa sethelperrole` or `/mwa setrepo`.');
            return;
        }
    }

    async addToBlacklist(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const identifier = interaction.options.getString('user');
        if (!identifier) {
            await replyEphemeral(interaction, 'Invalid user identifier');
            return;
        }

        const reason = interaction.options.getString('reason') || 'No reason provided';

        const author = await getAuthorFromIdentifier(guildHolder, identifier);
        if (!author) {
            await replyEphemeral(interaction, `Invalid identifier: ${identifier}. Please provide a valid Discord ID or username.`);
            return;
        }

        const blacklistedUsers = guildHolder.getConfigManager().getConfig(GuildConfigs.BLACKLISTED_USERS);
        if (blacklistedUsers.some(user => areAuthorsSame(user.author, author))) {
            await replyEphemeral(interaction, `User ${getAuthorsString([author])} is already in the do-not-archive list.`);
            return;
        }

        blacklistedUsers.push({ author, reason });
        guildHolder.getConfigManager().setConfig(GuildConfigs.BLACKLISTED_USERS, blacklistedUsers);

        interaction.reply({
            content: `Successfully added ${getAuthorsString([author])} to the do-not-archive list for reason: ${reason}`,
        });
    }

    async removeFromBlacklist(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const identifier = interaction.options.getString('user');
        if (!identifier) {
            await replyEphemeral(interaction, 'Invalid user identifier');
            return;
        }

        const author = await getAuthorFromIdentifier(guildHolder, identifier);
        if (!author) {
            await replyEphemeral(interaction, `Invalid identifier: ${identifier}. Please provide a valid Discord ID or username.`);
            return;
        }

        const blacklistedUsers = guildHolder.getConfigManager().getConfig(GuildConfigs.BLACKLISTED_USERS);
        const index = blacklistedUsers.findIndex(user => areAuthorsSame(user.author, author));
        if (index === -1) {
            await replyEphemeral(interaction, `User ${getAuthorsString([author])} is not in the do-not-archive list.`);
            return;
        }

        blacklistedUsers.splice(index, 1);
        guildHolder.getConfigManager().setConfig(GuildConfigs.BLACKLISTED_USERS, blacklistedUsers);

        interaction.reply({
            content: `Successfully removed ${getAuthorsString([author])} from the do-not-archive list.`,
        });
    }

    async listBlacklist(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const blacklistedUsers = guildHolder.getConfigManager().getConfig(GuildConfigs.BLACKLISTED_USERS);
        if (blacklistedUsers.length === 0) {
            await replyEphemeral(interaction, 'The do-not-archive list is empty.');
            return;
        }

        const response = `## Current Do-Not-Archive user list:\n` + blacklistedUsers.map(user => {
            return `- ${getAuthorsString([user.author])}: ${user.reason}`;
        }).join('\n');

        const chunks = splitIntoChunks(response, 2000);
        await interaction.reply({ content: chunks[0] });
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({ content: chunks[i] });
        }
    }

    async setRepo(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const url = interaction.options.getString('url')

        if (!url) {
            await replyEphemeral(interaction, 'Invalid URL')
            return
        }

        guildHolder.getConfigManager().setConfig(GuildConfigs.GITHUB_REPO_URL, url)
        await replyEphemeral(interaction, `Successfully set Git repository URL to ${url}!`);
        interaction.followUp({
            content: `<@${interaction.user.id}> Set the Git repository to ${url}!`,
        });

        try {
            await guildHolder.getRepositoryManager().updateRemote();
            await guildHolder.getRepositoryManager().pull();
            await guildHolder.getRepositoryManager().push();
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

    async setEditorRoles(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const dt = await (new SetEditorRolesMenu()).getBuilder(guildHolder);
        const row = new ActionRowBuilder()
            .addComponents(dt);
        await replyEphemeral(interaction, 'Select editor roles', { components: [row] })
    }

    async setHelperRole(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const dt = await (new SetHelperRoleMenu()).getBuilder(guildHolder);
        const row = new ActionRowBuilder()
            .addComponents(dt);
        await replyEphemeral(interaction, 'Select helper role', { components: [row] })
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

    async makeIndex(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        if (!interaction.channel || !interaction.channel.isTextBased() || !interaction.inGuild()) {
            await replyEphemeral(interaction, 'This command can only be used in a text channel.')
            return;
        }

        const currentCategories = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS);

        interaction.deferReply();

        const allChannels = await guildHolder.getGuild().channels.fetch();
        // get all categories in the guild

        let indexText = ['# Archive Index:'];
        const categories = Array.from(allChannels.filter(channel => {
            return channel && channel.type === ChannelType.GuildCategory && currentCategories.includes(channel.id)
        }).values()) as unknown as CategoryChannel[];

        for (const category of categories) {
            await category.fetch(); // Ensure the category is fully fetched
        }
        // sort by position
        categories.sort((a, b) => {
            return a.position - b.position;
        });
        for (const category of categories) {
            indexText.push(`## ${category.name}`);
            const channels = Array.from(allChannels.filter(channel => {
                return channel && channel.type === ChannelType.GuildForum && channel.parentId === category.id
            }).values()) as unknown as ForumChannel[];

            // Ensure channels are fully fetched
            for (const channel of channels) {
                await channel.fetch();
            }
            // sort by position
            channels.sort((a, b) => {
                return a.position - b.position;
            });

            for (const channel of channels) {
                const { code, description } = getCodeAndDescriptionFromTopic(channel.topic || '');
                indexText.push(`- [${code} ${channel.name}](${channel.url}): ${description || 'No description'}`);
            }
        }

        // send text in chunks of 2000 characters
        const chunks = [];
        let currentChunk = '';
        for (const line of indexText) {
            if ((currentChunk + line + '\n').length > 2000) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            currentChunk += line + '\n';
        }
        if (currentChunk) {
            chunks.push(currentChunk);
        }


        await interaction.editReply({ content: 'Index created! Please check the channel for the index.' });
        // send chunks
        for (const chunk of chunks) {
            await interaction.channel.send(chunk);
        }
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

        await interaction.deferReply()

        const tags = submissionChannel.availableTags.filter(tag => {
            return !SubmissionTags.some(t => t.name === tag.name)
        })
        const newTags = SubmissionTags.map((t) => {
            const existingTag = submissionChannel.availableTags.find(tag => tag.name === t.name);
            if (existingTag) {
                return existingTag;
            }
            return t;
        }).concat(tags);

        await submissionChannel.setAvailableTags(newTags);
        await submissionChannel.setDefaultReactionEmoji({
            name: '👍',
            id: null
        });

        const currentCategories = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS);

        const allchannels = await guildHolder.getGuild().channels.fetch()

        // get all categories in the guild
        const categories = guildHolder.getGuild().channels.cache.filter(channel => {
            return channel && channel.type === ChannelType.GuildCategory && currentCategories.includes(channel.id)
        });

        const endorserRoles = guildHolder.getConfigManager().getConfig(GuildConfigs.ENDORSE_ROLE_IDS);
        const editorRoles = guildHolder.getConfigManager().getConfig(GuildConfigs.EDITOR_ROLE_IDS);

        for (const category of categories.values()) {
            // set permissions
            if (category.type !== ChannelType.GuildCategory) {
                continue;
            }

            const permissions = category.permissionOverwrites;
            await permissions.edit(guildHolder.getGuild().roles.everyone, {
                SendMessages: false,
                SendMessagesInThreads: false,
                CreatePrivateThreads: false,
                CreatePublicThreads: false,
            })

            for (const endorserRole of endorserRoles) {
                await permissions.edit(endorserRole, {
                    SendMessagesInThreads: true,
                })
            }

            for (const editorRole of editorRoles) {
                await permissions.edit(editorRole, {
                    SendMessagesInThreads: true,
                    ManageThreads: true,
                    ManageMessages: true,
                    ManageChannels: true,
                })
            }
        }

        // get all channels in categories
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
                name: 'Recommended',
                emoji: { name: '⭐' },
                moderated: true
            }
        ] as GuildForumTag[];
        // check each channel

        const codeMap = new Map<Snowflake, string>();
        for (const channel of channels.values()) {
            const tags = channel.availableTags.filter(tag => {
                return !basicTags.some(t => t.name === tag.name)
            })
            const newTags = basicTags.map((t) => {
                const existingTag = channel.availableTags.find(tag => tag.name === t.name);
                if (existingTag) {
                    return existingTag;
                }
                return t;
            }).concat(tags);
            await channel.setAvailableTags(newTags)
            await channel.setDefaultReactionEmoji({
                name: '👍',
                id: null
            })
           // await channel.setDefaultForumLayout(ForumLayoutType.ListView)
            await channel.setDefaultSortOrder(SortOrderType.CreationDate)

            // check if topic exists
            if (channel.topic) {
                const { code } = getCodeAndDescriptionFromTopic(channel.topic);
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
        // let response = 'Channel codes:\n';
        // codeMap.forEach((code, channelId) => {
        //     const channel = guildHolder.getGuild().channels.cache.get(channelId);
        //     if (channel) {
        //         response += `- ${channel.name}: ${code}\n`;
        //     } else {
        //         response += `- Channel with ID ${channelId} not found.\n`;
        //     }
        // });
        // await interaction.channel.send(response);

        try {
            await guildHolder.getRepositoryManager().setupArchives(channels)
        } catch (error) {
            console.error('Error setting up archives:', error);
            await interaction.channel.send('An error occurred while setting up archives. Please check the console for details.');
            return;
        }

        await interaction.editReply('Archives setup complete! Please check the channels for the new tags and settings.');
    }

    async republishEverything(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        // Get all entries from the archive
        const silent = interaction.options.getBoolean('silent') || false;
        const replace = interaction.options.getBoolean('replace') || false;
        await interaction.reply('Starting to republish all entries. This may take a while depending on the size of the archive. You will be notified when it is complete.');
        try {
            await guildHolder.getRepositoryManager().republishAllEntries(silent, replace, interaction);
        } catch (error) {
            console.error('Error republishing all entries:', error);
            await interaction.followUp('An error occurred while republishing all entries. Please check the console for details.');
            return;
        }

        await interaction.followUp(`<@${interaction.user.id}> Republishing all entries complete!`);
    }

    async closeEverythingPosts(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {

        await interaction.reply('Starting to close all threads. This may take a while depending on the number of open threads. You will be notified when it is complete.');

        const currentCategories = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS);
        const allchannels = await guildHolder.getGuild().channels.fetch()
        // get all channels in categories
        const channels = allchannels.filter(channel => {
            return channel && channel.type === ChannelType.GuildForum && channel.parentId && currentCategories.includes(channel.parentId)
        }) as unknown as ForumChannel[];

        for (const channel of channels.values()) {
            const threads = await channel.threads.fetchActive();
            for (const thread of threads.threads.values()) {
                try {
                    await thread.setArchived(true, 'Closing thread as part of closeEverything command');
                } catch (error) {
                    console.error(`Error closing thread ${thread.name} (${thread.id}):`, error);
                }
            }
        }

        await interaction.followUp(`<@${interaction.user.id}> Closing all threads complete!`);
    }

    async closeEverythingSubmissions(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {

        const submissionChannelId = guildHolder.getConfigManager().getConfig(GuildConfigs.SUBMISSION_CHANNEL_ID);
        if (!submissionChannelId) {
            await interaction.followUp('Submission channel is not set. Please set it using `/mwa setsubmissions` command.');
            return;
        }
        const submissionChannel = await guildHolder.getGuild().channels.fetch(submissionChannelId);
        if (!submissionChannel || submissionChannel.type !== ChannelType.GuildForum) {
            await interaction.followUp('Submission channel is not a valid forum channel. Please set it using `/mwa setsubmissions` command.');
            return;
        }

        await interaction.reply('Starting to close all submission channels. This may take a while depending on the number of open submissions. You will be notified when it is complete.');

        const threads = await submissionChannel.threads.fetchActive();
        for (const thread of threads.threads.values()) {
            try {
                await thread.setArchived(true, 'Closing submission as part of closeEverything command');
            } catch (error) {
                console.error(`Error closing submission ${thread.name} (${thread.id}):`, error);
            }
        }
        await interaction.followUp(`<@${interaction.user.id}> Closing all submissions complete!`);
    }

     async updateAllSubmissionsStatus(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        await interaction.reply('Starting to update status of all submissions. This may take a while depending on the number of submissions. You will be notified when it is complete.');

        const submissionsById = await guildHolder.getSubmissionsManager().getSubmissionsList();
        for (const submissionID of submissionsById) {
            const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionID);
            if (!submission) {
                await interaction.followUp(`Submission with ID ${submissionID} not found, skipping.`);
                continue;
            }

            const channel = await submission.getSubmissionChannel(true);
            const isArchived = channel.archived;


            try {
                await submission.statusUpdated();
            } catch (error) {
                console.error(`Error updating status for submission ${submissionID}:`, error);
                await interaction.followUp(`Error updating status for submission ${submissionID}, check console for details.`);
            }

            if (isArchived) {
                // rearchive the channel
                await channel.setArchived(true, 'Re-archiving channel after status update');
            }
        }

        await interaction.followUp(`<@${interaction.user.id}> Updating status of all submissions complete!`);

     }
}