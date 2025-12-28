import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { isEditor, isModerator, replyEphemeral } from "../../utils/Util.js";
import { DictionaryEditModal } from "../modals/DictionaryEditModal.js";
import { GuildConfigs } from "../../config/GuildConfigs.js";
import { DictionaryEntryStatus } from "../../archive/DictionaryManager.js";

export class EditDictionaryEntryButton implements Button {
    getID(): string {
        return "dictionary-edit-button";
    }

    getBuilder(entryId: string, isApproved: boolean): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`${this.getID()}|${entryId}`)
            .setLabel('Edit Entry')
            .setStyle(isApproved ? ButtonStyle.Secondary : ButtonStyle.Primary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, entryId?: string): Promise<void> {
        if (!entryId) {
            await replyEphemeral(interaction, 'Dictionary entry not found.');
            return;
        }

        const dictionaryManager = guildHolder.getDictionaryManager();
        const entry = await dictionaryManager.getEntry(entryId);
        if (!entry) {
            await replyEphemeral(interaction, 'Dictionary entry not found.');
            return;
        }

        const thread = await dictionaryManager.fetchThread(entry.id);
        if (!thread) {
            await replyEphemeral(interaction, 'Dictionary thread not found.');
            return;
        }

        const dictionaryChannelId = guildHolder.getConfigManager().getConfig(GuildConfigs.DICTIONARY_CHANNEL_ID);
        if (dictionaryChannelId && thread.parentId !== dictionaryChannelId) {
            await replyEphemeral(interaction, 'This is not a dictionary thread.');
            return;
        }

        const isPrivileged = isEditor(interaction, guildHolder) || isModerator(interaction);
        const isAllowed = isPrivileged || entry.status !== DictionaryEntryStatus.APPROVED;
        if (!isAllowed) {
            await replyEphemeral(interaction, 'You do not have permission to edit dictionary entries.');
            return;
        }

        await interaction.showModal(await new DictionaryEditModal().getBuilder(entry));
    }
}
