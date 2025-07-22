import { ChannelType, ForumChannel, Snowflake, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { canEditSubmission, getCodeAndDescriptionFromTopic, replyEphemeral } from "../../utils/Util.js";
import { Submission } from "../../submissions/Submission.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { SetTagsMenu } from "./SetTagsMenu.js";

export class SetArchiveChannelMenu implements Menu {
    getID(): string {
        return "set-archive-channel-menu";
    }

    async getBuilder(guildHolder: GuildHolder, category: Snowflake, submission: Submission): Promise<StringSelectMenuBuilder> {
        const channels = await guildHolder.getGuild().channels.fetch()
        // Filter for category channels
        const categoryChannels = channels.filter(channel => {
            return channel && channel.type === ChannelType.GuildForum && channel.parentId === category
        }).map(channel => {
            if (!channel || channel.type !== ChannelType.GuildForum) {
                throw new Error('Channel not found');
            }
            return {
                id: channel.id,
                name: channel.name,
                topic: channel.topic || '',
                position: channel.position
            }
        });

        // sort by position
        categoryChannels.sort((a, b) => a.position - b.position);

        const currentArchiveChannel = submission.getConfigManager().getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(1)
            .setMaxValues(1)
            .setPlaceholder('Select archive channel')
            .addOptions(
                categoryChannels.map(channel => {
                    const {description} = getCodeAndDescriptionFromTopic(channel.topic || '');
                    return new StringSelectMenuOptionBuilder().setLabel(channel.name)
                        .setValue(channel.id)
                        .setDescription(description.substring(0, 100) || 'No description')
                        .setDefault(currentArchiveChannel === channel.id)
                })
            )
    }

    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction): Promise<void> {
        const submissionId = interaction.channelId
        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return
        }

        if (
            !canEditSubmission(interaction, submission)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return
        }

        const newChannel = interaction.values[0]
        const currentChannel = submission.getConfigManager().getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        if (currentChannel === newChannel) {
            return
        }
        submission.getConfigManager().setConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID, newChannel);

        const channel = await guildHolder.getGuild().channels.fetch(newChannel).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildForum) {
            await interaction.reply({ content: `Archive channel <#${newChannel}> not found`, ephemeral: true });
            return;
        }

        const topic = channel.topic || '';
        const { description } = getCodeAndDescriptionFromTopic(topic);

        if (!currentChannel) {
            await interaction.reply(`<@${interaction.user.id}> set archive channel to <#${newChannel}>: ${description}`);
        } else {
            await interaction.reply(`<@${interaction.user.id}> changed archive channel from <#${currentChannel}> to <#${newChannel}>: ${description}`)
        }

        // Migrate tags
        const tags = submission.getConfigManager().getConfig(SubmissionConfigs.TAGS);
        if (tags !== null && tags.length > 0) {
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
        await submission.statusUpdated();

        if (!currentChannel) {
            await SetTagsMenu.sendTagsMenu(submission, interaction);
        }

        submission.checkReview()
    }

}