import { ActionRowBuilder, BaseSelectMenuBuilder, Channel, ChannelSelectMenuBuilder, ChannelType, Collection, ForumChannel, MessageFlags, Snowflake, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, ThreadChannel } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Menu } from "../../interface/Menu";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { GuildConfigs } from "../../config/GuildConfigs";
import { Submission } from "../../submissions/Submission";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs";
import { SetTagsMenu } from "./SetTagsMenu";

export class SetArchiveChannelMenu implements Menu {
    getID(): string {
        return "set-archive-channel-menu";
    }

    async getBuilder(guildHolder: GuildHolder, category: Snowflake, submission: Submission): Promise<StringSelectMenuBuilder> {
        const channels = await guildHolder.getGuild().channels.fetch()
        // Filter for category channels
        const categoryChannels = channels.filter(channel => {
            return channel && channel.type === ChannelType.GuildForum && channel.parentId === category
        }) as unknown as Collection<Snowflake, ThreadChannel>;
        const currentArchiveChannel = submission.getConfigManager().getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(1)
            .setMaxValues(1)
            .setPlaceholder('Select archive channel')
            .addOptions(
                Array.from(categoryChannels.values()).map(channel => {
                    return new StringSelectMenuOptionBuilder().setLabel(channel.name)
                        .setValue(channel.id)
                        .setDefault(currentArchiveChannel === channel.id)
                })
            )
    }

    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction, ...args: string[]): Promise<void> {
        if (
            !isOwner(interaction) &&
            !hasPerms(interaction)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return
        }

        const submissionId = interaction.channelId
        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return
        }

        const newChannel = interaction.values[0]
        const currentChannel = submission.getConfigManager().getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        if (currentChannel === newChannel) {
            return
        }
        submission.getConfigManager().setConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID, newChannel);

        if (!currentChannel) {
            await interaction.reply(`<@${interaction.user.id}> set archive channel to <#${newChannel}>`)
        } else {
            await interaction.reply(`<@${interaction.user.id}> changed archive channel from <#${currentChannel}> to <#${newChannel}>`)
        }

        // Migrate tags
        const tags = submission.getConfigManager().getConfig(SubmissionConfigs.TAGS);
        if (tags !== null && tags.length > 0) {
            const channel = await guildHolder.getGuild().channels.fetch(newChannel) as ForumChannel;
            if (!channel) {
                await interaction.followUp(`Archive channel <#${newChannel}> not found, tags will not be migrated.`);
                return;
            }

            const availableTags = channel.availableTags;
            const migratedTags = [];
            const removedTags = [];
            for (const tag of tags) {
                const newTag = availableTags.find(t => t.name === tag.name);
                if (newTag) {
                    migratedTags.push(newTag);
                } else {
                    removedTags.push(tag);
                }
            }

            submission.getConfigManager().setConfig(SubmissionConfigs.TAGS, migratedTags.map(t => {
                return {
                    name: t.name,
                    id: t.id
                }
            }));

            if (removedTags.length) {
                await interaction.followUp(`Not all tags were migrated, the following tags were removed because they are not available in the new channel: ${removedTags.map(o => o.name).join(', ')}`)
            }
        }
        submission.statusUpdated();

        if (!currentChannel) {
            const component = await new SetTagsMenu().getBuilder(guildHolder, hasPerms(interaction), submission);
            const row = new ActionRowBuilder()
                .addComponents(component);
            await interaction.followUp({
                content: `<@${interaction.user.id}> Please select tags`,
                components: [row as any],
                flags: MessageFlags.Ephemeral
            })
        }

        submission.checkReview()
    }

}