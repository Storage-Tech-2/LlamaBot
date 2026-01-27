import { StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { RepositoryConfigs } from "../../archive/RepositoryConfigs.js";
import { Menu } from "../../interface/Menu.js";
import { deepClone, isAdmin, replyEphemeral } from "../../utils/Util.js";
import { GlobalTagModal } from "../modals/GlobalTagModal.js";

export class GlobalTagSelectMenu implements Menu {
    getID(): string {
        return "global-tag-select";
    }

    async getBuilder(guildHolder: GuildHolder, action: 'edit' | 'remove', deleteTag: boolean = true): Promise<StringSelectMenuBuilder> {
        const tags = guildHolder.getRepositoryManager().getConfigManager().getConfig(RepositoryConfigs.GLOBAL_TAGS);
        const deleteSuffix = action === 'remove' ? `|${deleteTag ? 'delete' : 'keep'}` : '';
        return new StringSelectMenuBuilder()
            .setCustomId(`${this.getID()}|${action}${deleteSuffix}`)
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

    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction, action: string, deleteMode?: string): Promise<void> {
        if (!isAdmin(interaction)) {
            replyEphemeral(interaction, 'You do not have permission to manage global tags.');
            return;
        }

        const tagName = interaction.values[0];
        const configManager = guildHolder.getRepositoryManager().getConfigManager();
        const tags = configManager.getConfig(RepositoryConfigs.GLOBAL_TAGS);
        const oldTags = deepClone(tags);
        const tagIndex = tags.findIndex(tag => tag.name === tagName);

        if (tagIndex === -1) {
            replyEphemeral(interaction, 'Selected tag could not be found. Please try again.');
            return;
        }

        if (action === 'remove') {
            const deleteTag = deleteMode !== 'keep'; // default to deleting for legacy custom IDs
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

            const deleteRemovedTagNames = deleteTag ? [removedTag.name] : [];
            guildHolder.setPendingGlobalTagChange(oldTags, updatedTags, { deleteRemovedTagNames });

            await interaction.deferUpdate();

            await interaction.editReply({
                content: `Removed global tag "${removedTag.name}".${deleteTag ? '' : ' Existing archive tags were kept.'} Run /mwa applyglobaltags to sync forums.\n${guildHolder.getPendingGlobalTagSummary()}`,
                components: []
            });
            return;
        }

        if (action === 'edit') {
            const tag = tags[tagIndex];
            const modal = new GlobalTagModal().getBuilder('edit', tag);
            await interaction.showModal(modal);
            return;
        }

        replyEphemeral(interaction, 'Unknown action for this menu.');
    }
}
