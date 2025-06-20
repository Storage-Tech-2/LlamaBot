import { ChannelSelectMenuBuilder, ChannelType, Snowflake, StringSelectMenuInteraction } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { isAdmin, replyEphemeral } from "../../utils/Util.js";
import { GuildConfigs } from "../../config/GuildConfigs.js";

export class SetArchiveCategoriesMenu implements Menu {
    getID(): string {
        return "set-archive-categories";
    }

    async getBuilder(guildHolder: GuildHolder, currentCategories: Snowflake[]): Promise<ChannelSelectMenuBuilder> {
        const channels = await guildHolder.getGuild().channels.fetch()
        const categoryChannels = channels.filter(channel => channel && channel.type === ChannelType.GuildCategory)
        return new ChannelSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(0)
            .setMaxValues(Math.min(categoryChannels.size, 25))
            .setPlaceholder('Select archive categories')
            .setChannelTypes(ChannelType.GuildCategory)
            .setDefaultChannels(currentCategories)
    }
    
    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction): Promise<void> {
        if (!isAdmin(interaction)) {
            replyEphemeral(interaction, 'You do not have permission to use this menu!');
            return;
        }
        
        const currentCategories = new Set(guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS))
        const newCategories = new Set(interaction.values || [])
        const added = Array.from(newCategories.difference(currentCategories)).map(c => `<#${c}>`)
        const removed = Array.from(currentCategories.difference(newCategories)).map(c => `<#${c}>`)
        guildHolder.getConfigManager().setConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS, Array.from(newCategories))
        guildHolder.updatePostChannelsCache();
        const str = []

        if (added.length) {
            str.push('added ' + added.join(', '))
        }

        if (removed.length) {
            str.push('removed ' + removed.join(', '))
        }

        if (str.length) {
            interaction.reply(`<@${interaction.user.id}> ${str.join(' and ')} to archive categories`)
        }

    }

}