import { StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, Snowflake } from "discord.js";
import { randomUUID } from "crypto";
import { GuildHolder } from "../../GuildHolder.js";
import { GlobalTag, RepositoryConfigs } from "../../archive/RepositoryConfigs.js";
import { Menu } from "../../interface/Menu.js";
import { isAdmin, replyEphemeral } from "../../utils/Util.js";
import { findTagNameConflict, getArchiveForumChannels, syncGlobalTagRemove, syncGlobalTagUpdate } from "../../utils/GlobalTagUtils.js";

export type GlobalTagUpdates = {
    name?: string;
    emoji?: string | null;
    moderated?: boolean;
    colorWeb?: string | null;
    colorMod?: number | null;
};

type StoredPayload = {
    updates: GlobalTagUpdates;
    userId: Snowflake;
};

const PAYLOAD_TTL_MS = 5 * 60 * 1000;
const payloadStore = new Map<string, StoredPayload>();

function storePayload(payload: StoredPayload): string {
    const token = randomUUID();
    payloadStore.set(token, payload);
    setTimeout(() => payloadStore.delete(token), PAYLOAD_TTL_MS).unref?.();
    return token;
}

function consumePayload(token: string): StoredPayload | undefined {
    const payload = payloadStore.get(token);
    if (payload) {
        payloadStore.delete(token);
    }
    return payload;
}

function applyUpdatesToTag(tag: GlobalTag, updates: GlobalTagUpdates): GlobalTag {
    const updated = { ...tag };

    if (Object.prototype.hasOwnProperty.call(updates, 'name') && updates.name !== undefined) {
        updated.name = updates.name;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'emoji')) {
        updated.emoji = updates.emoji ?? undefined;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'moderated') && updates.moderated !== undefined) {
        updated.moderated = updates.moderated;
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'colorWeb')) {
        if (updates.colorWeb === null) {
            delete updated.colorWeb;
        } else if (updates.colorWeb !== undefined) {
            updated.colorWeb = updates.colorWeb;
        }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'colorMod')) {
        if (updates.colorMod === null) {
            delete updated.colorMod;
        } else if (updates.colorMod !== undefined) {
            updated.colorMod = updates.colorMod;
        }
    }

    updated.name = updated.name.trim();
    return updated;
}

export function hasGlobalTagUpdates(updates: GlobalTagUpdates): boolean {
    return Object.prototype.hasOwnProperty.call(updates, 'name')
        || Object.prototype.hasOwnProperty.call(updates, 'emoji')
        || Object.prototype.hasOwnProperty.call(updates, 'moderated')
        || Object.prototype.hasOwnProperty.call(updates, 'colorWeb')
        || Object.prototype.hasOwnProperty.call(updates, 'colorMod');
}

export class GlobalTagSelectMenu implements Menu {
    getID(): string {
        return "global-tag-select";
    }

    static createPayload(updates: GlobalTagUpdates, userId: Snowflake): string {
        return storePayload({ updates, userId });
    }

    async getBuilder(guildHolder: GuildHolder, action: 'edit' | 'remove', token?: string): Promise<StringSelectMenuBuilder> {
        const tags = guildHolder.getRepositoryManager().getConfigManager().getConfig(RepositoryConfigs.GLOBAL_TAGS);

        const customId = [this.getID(), action, token].filter(Boolean).join('|');
        return new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setMinValues(1)
            .setMaxValues(1)
            .setPlaceholder('Select a global tag')
            .addOptions(tags.map(tag => {
                const option = new StringSelectMenuOptionBuilder()
                    .setLabel(tag.name)
                    .setValue(tag.name);

                if (tag.emoji) {
                    option.setEmoji({ name: tag.emoji });
                }

                if (tag.moderated) {
                    option.setDescription('Moderated tag');
                }

                return option;
            }));
    }

    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction, action: string, token?: string): Promise<void> {
        if (!isAdmin(interaction)) {
            replyEphemeral(interaction, 'You do not have permission to manage global tags.');
            return;
        }

        const tagName = interaction.values[0];
        const configManager = guildHolder.getRepositoryManager().getConfigManager();
        const tags = configManager.getConfig(RepositoryConfigs.GLOBAL_TAGS);
        const tagIndex = tags.findIndex(tag => tag.name === tagName);

        if (tagIndex === -1) {
            replyEphemeral(interaction, 'Selected tag could not be found. Please try again.');
            return;
        }

        if (action === 'remove') {
            const removedTag = tags[tagIndex];
            const updatedTags = [...tags];
            updatedTags.splice(tagIndex, 1);

            configManager.setConfig(RepositoryConfigs.GLOBAL_TAGS, updatedTags);
            try {
                await guildHolder.getRepositoryManager().configChanged();
            } catch (error: any) {
                replyEphemeral(interaction, `Failed to save tag changes: ${error?.message || error}`);
                return;
            }

            const channels = await getArchiveForumChannels(guildHolder);
            let syncMessage = '';
            try {
                const syncResult = await syncGlobalTagRemove(guildHolder, removedTag.name, channels);
                syncMessage = ` Synced to ${syncResult.updated}/${syncResult.total} archive forums.`;
            } catch (error: any) {
                syncMessage = ' Failed to sync archive forums, please try again.';
            }

            await interaction.update({
                content: `Removed global tag "${removedTag.name}".${syncMessage}`,
                components: []
            });
            return;
        }

        if (action === 'edit') {
            if (!token) {
                replyEphemeral(interaction, 'This edit action is missing data. Please rerun the command.');
                return;
            }

            const payload = consumePayload(token);
            if (!payload || !hasGlobalTagUpdates(payload.updates)) {
                replyEphemeral(interaction, 'This edit action has expired. Please rerun the command.');
                return;
            }

            if (payload.userId !== interaction.user.id) {
                replyEphemeral(interaction, 'Only the admin who started this edit can finish it.');
                return;
            }

            const originalTag = tags[tagIndex];
            const updatedTag = applyUpdatesToTag(originalTag, payload.updates);

            if (!updatedTag.name) {
                replyEphemeral(interaction, 'Tag name cannot be empty.');
                return;
            }

            if (tags.some((tag, idx) => idx !== tagIndex && tag.name.toLowerCase() === updatedTag.name.toLowerCase())) {
                replyEphemeral(interaction, `Another global tag named "${updatedTag.name}" already exists.`);
                return;
            }

            const channels = await getArchiveForumChannels(guildHolder);
            const conflictChannel = findTagNameConflict(channels, originalTag.name, updatedTag.name);
            if (conflictChannel) {
                replyEphemeral(interaction, `A tag named "${updatedTag.name}" already exists in ${conflictChannel.toString()}. Rename it first or choose a different name.`);
                return;
            }

            const updatedTags = [...tags];
            updatedTags[tagIndex] = updatedTag;

            configManager.setConfig(RepositoryConfigs.GLOBAL_TAGS, updatedTags);
            try {
                await guildHolder.getRepositoryManager().configChanged();
            } catch (error: any) {
                replyEphemeral(interaction, `Failed to save tag changes: ${error?.message || error}`);
                return;
            }

            let syncMessage = '';
            try {
                const syncResult = await syncGlobalTagUpdate(guildHolder, originalTag.name, updatedTag, channels);
                syncMessage = ` Synced to ${syncResult.updated}/${syncResult.total} archive forums.`;
            } catch (error: any) {
                syncMessage = ' Failed to sync archive forums, please try again.';
            }

            await interaction.update({
                content: `Updated global tag "${originalTag.name}" to "${updatedTag.name}".${syncMessage}`,
                components: []
            });
            return;
        }

        replyEphemeral(interaction, 'Unknown action for this menu.');
    }
}
