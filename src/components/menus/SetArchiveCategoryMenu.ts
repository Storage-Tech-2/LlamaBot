import { ActionRowBuilder, CategoryChannel, ChannelType, Collection, ForumChannel, Snowflake, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { GuildConfigs } from "../../config/GuildConfigs.js";
import { SetArchiveChannelMenu } from "./SetArchiveChannelMenu.js";

export class SetArchiveCategoryMenu implements Menu {
    getID(): string {
        return "set-archive-category-menu";
    }

    async getBuilder(guildHolder: GuildHolder): Promise<StringSelectMenuBuilder> {
        const channels = await guildHolder.getGuild().channels.fetch()
        const currentCategories = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS) as Snowflake[] || [];
        const categoryChannels = channels.filter(channel => {
            return channel && channel.type === ChannelType.GuildCategory && currentCategories.includes(channel.id)
        }) as unknown as Collection<Snowflake, CategoryChannel>;
        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(1)
            .setMaxValues(1)
            .setPlaceholder('Select archive category')
            .addOptions(
                Array.from(categoryChannels.values()).map(channel => {
                     
                    const categoryChannels = channels.filter(channel2 => {
                        return channel2 && channel2.type === ChannelType.GuildForum && channel2.parentId === channel.id
                    }) as unknown as Collection<Snowflake, ForumChannel>;

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
        await replyEphemeral(interaction, `<@${interaction.user.id}> Please select an archive channel`, {
            components: [row]
        })

    }

}