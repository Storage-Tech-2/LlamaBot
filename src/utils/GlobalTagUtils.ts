import { ChannelType, ForumChannel, GuildForumTag, GuildForumTagData } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { GlobalTag } from "../archive/RepositoryConfigs.js";
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

function toForumEmoji(emoji?: string): GuildForumTagData["emoji"] {
    if (!emoji) {
        return null;
    }
    return {
        id: null,
        name: emoji,
    };
}

function cloneForumTag(tag: GuildForumTag): GuildForumTagData {
    return {
        id: tag.id,
        name: tag.name,
        moderated: tag.moderated,
        emoji: tag.emoji ? { id: tag.emoji.id, name: tag.emoji.name } : null,
    };
}

function toForumTagData(tag: GlobalTag, existing?: GuildForumTag): GuildForumTagData {
    return {
        id: existing?.id,
        name: tag.name,
        moderated: !!tag.moderated,
        emoji: toForumEmoji(tag.emoji),
    };
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

export async function syncGlobalTagAdd(guildHolder: GuildHolder, tag: GlobalTag, existingChannels?: ForumChannel[]): Promise<{ total: number; updated: number }> {
    const channels = existingChannels ?? await getArchiveForumChannels(guildHolder);
    let updated = 0;

    for (const channel of channels) {
        const availableTags = channel.availableTags.map(cloneForumTag);
        const current = channel.availableTags.find(t => t.name === tag.name);
        const tagData = toForumTagData(tag, current);

        const index = availableTags.findIndex(t => t.name === tag.name);
        if (index !== -1) {
            availableTags[index] = tagData;
        } else {
            availableTags.push(tagData);
        }

        await channel.setAvailableTags(availableTags);
        updated++;
    }

    return { total: channels.length, updated };
}

export async function syncGlobalTagUpdate(guildHolder: GuildHolder, previousName: string, tag: GlobalTag, existingChannels?: ForumChannel[]): Promise<{ total: number; updated: number }> {
    const channels = existingChannels ?? await getArchiveForumChannels(guildHolder);
    let updated = 0;

    for (const channel of channels) {
        const availableTags = channel.availableTags.map(cloneForumTag);
        const current = channel.availableTags.find(t => t.name === previousName);
        const tagData = toForumTagData(tag, current);
        const index = availableTags.findIndex(t => t.name === previousName);

        if (index !== -1) {
            availableTags[index] = tagData;
        } else {
            availableTags.push(tagData);
        }

        await channel.setAvailableTags(availableTags);
        updated++;
    }

    return { total: channels.length, updated };
}

export async function syncGlobalTagRemove(guildHolder: GuildHolder, tagName: string, existingChannels?: ForumChannel[]): Promise<{ total: number; updated: number }> {
    const channels = existingChannels ?? await getArchiveForumChannels(guildHolder);
    let updated = 0;

    for (const channel of channels) {
        const remaining = channel.availableTags.filter(tag => tag.name !== tagName).map(cloneForumTag);
        if (remaining.length === channel.availableTags.length) {
            continue;
        }

        await channel.setAvailableTags(remaining);
        updated++;
    }

    return { total: channels.length, updated };
}
