import { ChannelType, ForumChannel } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { GuildConfigs } from "../config/GuildConfigs.js";

export async function getArchiveForumChannels(guildHolder: GuildHolder): Promise<ForumChannel[]> {
    const categoryIds = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS);
    if (!categoryIds.length) {
        return [];
    }

    const channels = await guildHolder.getGuild().channels.fetch();
    return Array.from(
        channels
            .filter(channel => channel?.type === ChannelType.GuildForum && channel.parentId && categoryIds.includes(channel.parentId))
            .values()
    ) as ForumChannel[];
}

export function findTagNameConflict(channels: ForumChannel[], previousName: string, newName: string): ForumChannel | null {
    if (previousName.toLowerCase() === newName.toLowerCase()) {
        return null;
    }

    for (const channel of channels) {
        const current = channel.availableTags.find(tag => tag.name.toLowerCase() === previousName.toLowerCase());
        const conflict = channel.availableTags.find(tag => tag.name.toLowerCase() === newName.toLowerCase() && (!current || tag.id !== current.id));
        if (conflict) {
            return channel;
        }
    }

    return null;
}
