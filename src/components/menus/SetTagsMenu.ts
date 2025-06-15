import { ActionRowBuilder, BaseSelectMenuBuilder, Channel, ChannelSelectMenuBuilder, ChannelType, Collection, ForumChannel, MessageFlags, Snowflake, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, ThreadChannel } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Menu } from "../../interface/Menu";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { GuildConfigs } from "../../config/GuildConfigs";
import { Submission } from "../../submissions/Submission";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs";
import { SetImagesMenu } from "./SetImagesMenu";

export class SetTagsMenu implements Menu {
    getID(): string {
        return "set-tags-menu";
    }

    async getBuilder(guildHolder: GuildHolder, isMod: boolean, submission: Submission): Promise<StringSelectMenuBuilder> {
        const archiveChannelId = submission.getConfigManager().getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        const channel = await guildHolder.getGuild().channels.fetch(archiveChannelId) as ForumChannel;
        const tags = channel.availableTags.filter(tag => {
            return !tag.moderated || isMod || currentTags.some(t => t.id === tag.id);
        })
        if (!tags.length) {
            tags.push({
                id: 'none',
                name: 'No tags available',
                moderated: false,
                emoji: null
            })
        }
        const currentTags = submission.getConfigManager().getConfig(SubmissionConfigs.TAGS) || [];
        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(0)
            .setMaxValues(Math.min(tags.length, 25))
            .setPlaceholder('Select tags')
            .addOptions(
                Array.from(tags).map(tag => {
                    const opt = new StringSelectMenuOptionBuilder().setLabel(tag.name)
                        .setValue(tag.id)
                        .setDefault(currentTags.some(t => t.id === tag.id))
                    if (tag.emoji?.name) {
                        opt.setEmoji({ name: tag.emoji.name })
                    }
                    return opt
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
            replyEphemeral(interaction, 'Submission not found');
            return;
        }

        const archiveChannelId = submission.getConfigManager().getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        const channel = await guildHolder.getGuild().channels.fetch(archiveChannelId) as ForumChannel | null;
        if (!channel) {
            replyEphemeral(interaction, 'Archive channel not found')
            return
        }

        const availableTags = channel.availableTags;
        const tagsUnset = submission.getConfigManager().getConfig(SubmissionConfigs.TAGS) === null;
        const currentTags = submission.getConfigManager().getConfig(SubmissionConfigs.TAGS) || [];
        const newTagIds = new Set(interaction.values)
        newTagIds.delete('none') // remove 'none' if it exists

        if (!hasPerms(interaction)) {
            const tagsAdmin = new Set(availableTags.filter(tag => {
                return tag.moderated
            }).map(tag => tag.id))

            tagsAdmin.forEach(tag => {
                newTagIds.delete(tag)
            })

            currentTags.forEach(tag => {
                if (tagsAdmin.has(tag.id)) {
                    newTagIds.add(tag.id)
                }
            })
        }

        const added: string[] = [];
        const removed: string[] = [];

        newTagIds.forEach(tagId => {
            if (!currentTags.some(t => t.id === tagId)) {
                const tag = availableTags.find(t => t.id === tagId);
                if (tag) {
                    added.push(tag.name);
                }
            }
        });

        currentTags.forEach(tag => {
            if (!newTagIds.has(tag.id)) {
                removed.push(tag.name);
            }
        });

        if (added.length || removed.length) {
            submission.getConfigManager().setConfig(SubmissionConfigs.TAGS, Array.from(newTagIds).map(tagId => {
                const tag = availableTags.find(t => t.id === tagId);
                return {
                    id: tagId,
                    name: tag ? tag.name : 'Unknown Tag',
                }
            }));
        }

        const str = []

        if (added.length) {
            str.push('added ' + added.join(', '))
        }

        if (removed.length) {
            str.push('removed ' + removed.join(', '))
        }

        if (str.length) {
            await interaction.reply(`<@${interaction.user.id}> ${str.join(' and ')} to tags`)
            submission.updateStatusMessage()
        }

        if (str.length && tagsUnset) {
            const row = new ActionRowBuilder()
                .addComponents(await new SetImagesMenu().getBuilder(guildHolder, submission))
            await interaction.followUp({
                content: `<@${interaction.user.id}> Please set a main image`,
                components: [row as any],
                flags: MessageFlags.Ephemeral
            })
        }

        submission.checkReview()
    }

}