import { ActionRowBuilder, ForumChannel, Interaction, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { canEditSubmission, canSetPrivilegedTags, replyEphemeral, truncateStringWithEllipsis } from "../../utils/Util.js";
import { Submission } from "../../submissions/Submission.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { SetImagesMenu } from "./SetImagesMenu.js";
export class SetTagsMenu implements Menu {
    getID(): string {
        return "set-tags-menu";
    }

    async getBuilder(guildHolder: GuildHolder, isMod: boolean, submission: Submission): Promise<StringSelectMenuBuilder> {
        const archiveChannelId = submission.getConfigManager().getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        const channel = await guildHolder.getGuild().channels.fetch(archiveChannelId) as ForumChannel;
        const currentTags = submission.getConfigManager().getConfig(SubmissionConfigs.TAGS) || [];
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
        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(0)
            .setMaxValues(Math.min(tags.length, 5))
            .setPlaceholder('Select tags')
            .addOptions(
                Array.from(tags).map(tag => {
                    const opt = new StringSelectMenuOptionBuilder().setLabel(truncateStringWithEllipsis(tag.name, 100))
                        .setValue(tag.id)
                        .setDefault(currentTags.some(t => t.id === tag.id))
                    if (tag.emoji?.name) {
                        opt.setEmoji({ name: tag.emoji.name })
                    }
                    return opt
                })
            )
    }

    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction, ..._args: string[]): Promise<void> {
        const submissionId = interaction.channelId
        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found');
            return;
        }

        if (
            !canEditSubmission(interaction, submission)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return
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

        if (!canSetPrivilegedTags(interaction, submission)) {
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
            await submission.statusUpdated()
        }

        if (tagsUnset) {
            await SetImagesMenu.sendImagesMenuAndButton(submission, interaction);
        }

        submission.checkReview()
    }


    public static async sendTagsMenu(submission: Submission, interaction: Interaction) {
        const guildHolder = submission.getGuildHolder();
        const isMod = canSetPrivilegedTags(interaction, submission);
        const tagsMenu = new SetTagsMenu();
        const menuBuilder = await tagsMenu.getBuilder(guildHolder, isMod, submission);
        const row = new ActionRowBuilder().addComponents(menuBuilder);

        await replyEphemeral(interaction, `Please select tag(s) for the submission`, {
            components: [row as any],
        });
    }
}