import { ActionRowBuilder, ChannelType, Interaction, Message, Snowflake, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { GuildConfigs } from "../../config/GuildConfigs.js";
import { SetArchiveChannelMenu } from "./SetArchiveChannelMenu.js";
import { Submission } from "../../submissions/Submission.js";

export class SetArchiveCategoryMenu implements Menu {
    getID(): string {
        return "set-archive-category-menu";
    }

    async getBuilder(guildHolder: GuildHolder): Promise<StringSelectMenuBuilder> {
        const channels = await guildHolder.getGuild().channels.fetch()
        const currentCategories = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS) as Snowflake[];
        // const categoryChannels = channels.filter(channel => {
        //     return channel && channel.type === ChannelType.GuildCategory && currentCategories.includes(channel.id)
        // }) as unknown as Collection<Snowflake, CategoryChannel>;

        const categoryChannels = channels.filter(channel => {
            return channel && channel.type === ChannelType.GuildCategory && currentCategories.includes(channel.id)
        }).map(channel => {
            if (!channel || channel.type !== ChannelType.GuildCategory) {
                throw new Error('Channel not found');
            }
            return {
                id: channel.id,
                name: channel.name,
                position: channel.position
            }
        });

        // sort by position
        categoryChannels.sort((a, b) => a.position - b.position);

        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(1)
            .setMaxValues(1)
            .setPlaceholder('Select archive category')
            .addOptions(
                Array.from(categoryChannels.values()).map(channel => {

                    const categoryChannels = channels.filter(channel2 => {
                        return channel2 && channel2.type === ChannelType.GuildForum && channel2.parentId === channel.id
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

                    const description = categoryChannels.map(c => `#${c.name}`).join(', ') || 'No forum channels in this category';
                    return new StringSelectMenuOptionBuilder().setLabel(channel.name).setValue(channel.id).setDescription(description.substring(0, 100));
                })
            )
    }

    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction): Promise<void> {
        const submissionId = interaction.channelId
        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return;
        }

        if (
            !canEditSubmission(interaction, submission)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return
        }

        const newCategory = interaction.values[0]
        const row = new ActionRowBuilder()
            .addComponents(await new SetArchiveChannelMenu().getBuilder(guildHolder, newCategory, submission))
        await interaction.update({
            content: `Please select an archive channel`,
            components: [row as any]
        })

    }

    public static async sendArchiveCategorySelector(submission: Submission, interaction: Interaction): Promise<Message> {

        const categories = submission.getGuildHolder().getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS);
        if (categories.length === 0) {
            return await replyEphemeral(interaction, `No archive categories have been set for this server. Please set them using \`/mwa setarchives\` command.`);
        }

        if (categories.length === 1) {
            const categoryId = categories[0];
            const row = new ActionRowBuilder()
                .addComponents(await new SetArchiveChannelMenu().getBuilder(submission.getGuildHolder(), categoryId, submission))
            return await replyEphemeral(interaction, `Please select an archive channel`, {
                components: [row]
            })
        } else {
            const row = new ActionRowBuilder()
                .addComponents(await new SetArchiveCategoryMenu().getBuilder(submission.getGuildHolder()))
            return await replyEphemeral(interaction, `Please select an archive category for your submission`, {
                components: [row as any],
            })
        }
    }

}