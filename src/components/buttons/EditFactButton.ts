import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { isAdmin, isEditor, isModerator, replyEphemeral } from "../../utils/Util.js";
import { FactEditModal } from "../modals/FactEditModal.js";

export class EditFactButton implements Button {
    getID(): string {
        return "fact-edit-button";
    }

    getBuilder(factId: string): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`${this.getID()}|${factId}`)
            .setLabel('Edit Entry')
            .setStyle(ButtonStyle.Primary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, factId?: string): Promise<void> {
        if (!factId) {
            await replyEphemeral(interaction, 'Fact entry not found.');
            return;
        }

        const factManager = guildHolder.getFactManager();
        const entry = await factManager.getFact(factId);
        if (!entry) {
            await replyEphemeral(interaction, 'Fact entry not found.');
            return;
        }

        const isPrivileged = isEditor(interaction, guildHolder) || isModerator(interaction) || isAdmin(interaction);
        if (!isPrivileged) {
            await replyEphemeral(interaction, 'You do not have permission to edit fact entries.');
            return;
        }

        await interaction.showModal(await new FactEditModal().getBuilder(factId, entry));
    }
}
