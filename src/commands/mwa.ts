import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, InteractionContextType, ChannelType, ActionRowBuilder, AnyComponentBuilder, ForumChannel, ForumThreadChannel, GuildForumTag, ForumLayoutType, SortOrderType } from "discord.js";
import { GuildHolder } from "../GuildHolder";
import { Command } from "../interface/Command";
import { replyEphemeral } from "../utils/Util";
import { GuildConfigs } from "../config/GuildConfigs";
import { SetArchiveCategoriesMenu } from "../components/menus/SetArchiveCategoriesMenu";

export class Mwa implements Command {
    getID(): string {
        return "mwa";
    }

    getBuilder(guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data
            .setName('mwa')
            .setDescription('Llamabot commands')
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
                    .setName('setpolls')
                    .setDescription('Setup Llamabot to send polls to a channel')
                    .addChannelOption(option =>
                        option
                            .setName('channel')
                            .setDescription('Channel to send polls to')
                            .setRequired(true)
                            .addChannelTypes(ChannelType.GuildForum)
                    )
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
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (interaction.options.getSubcommand() === 'setsubmissions') {
            this.setSubmissions(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'setarchives') {
            this.setArchives(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'setpolls') {
            this.setPolls(guildHolder, interaction)
        } else if (interaction.options.getSubcommand() === 'setuparchives') {
            this.setupArchives(guildHolder, interaction)
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

    async setPolls(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const channel = interaction.options.getChannel('channel')
        if (!channel) {
            await replyEphemeral(interaction, 'Invalid channel')
            return
        }

        guildHolder.getConfigManager().setConfig(GuildConfigs.POLLS_CHANNEL_ID, channel.id)
        await replyEphemeral(interaction, `Llamabot will now send polls to ${channel.name}!`);
    }


    async setupArchives(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
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
        }
        await interaction.editReply('Tags added to all channels')
    }
}