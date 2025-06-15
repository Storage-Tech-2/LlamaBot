import { ActionRowBuilder, CategoryChannel, ChannelType, Collection, Snowflake, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Menu } from "../../interface/Menu";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { GuildConfigs } from "../../config/GuildConfigs";
import { SetArchiveChannelMenu } from "./SetArchiveChannelMenu";

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
                    return new StringSelectMenuOptionBuilder().setLabel(channel.name).setValue(channel.id)
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
            return;
        }

        const newCategory = interaction.values[0]
        const row = new ActionRowBuilder()
            .addComponents(await new SetArchiveChannelMenu().getBuilder(guildHolder, newCategory, submission))
        await replyEphemeral(interaction, `<@${interaction.user.id}> Please select an archive channel`, {
            components: [row]
        })

    }

}