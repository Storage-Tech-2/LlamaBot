import { LabelBuilder, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { Modal } from "../../interface/Modal.js";
import { GuildHolder } from "../../GuildHolder.js";
import { isAdmin, isEditor, isModerator, replyEphemeral } from "../../utils/Util.js";
import { FactSheet } from "../../archive/PrivateFactBase.js";

export class FactEditModal implements Modal {
    getID(): string {
        return "facteditmodal";
    }

    async getBuilder(identifier: string, entry: FactSheet): Promise<ModalBuilder> {
        const modal = new ModalBuilder()
            .setCustomId(`${this.getID()}|${identifier}`)
            .setTitle('Edit Fact Entry');

        const termsInput = new TextInputBuilder()
            .setCustomId('title')
            .setRequired(true)
            .setStyle(TextInputStyle.Short)
            .setValue(entry.page_title || '');

        const termsLabel = new LabelBuilder()
            .setLabel('Page Title:')
            .setTextInputComponent(termsInput);

        const definitionInput = new TextInputBuilder()
            .setCustomId('text')
            .setRequired(false)
            .setStyle(TextInputStyle.Paragraph)
            .setValue(entry.text || '');

        const definitionLabel = new LabelBuilder()
            .setLabel('Page Text:')
            .setTextInputComponent(definitionInput);

        modal.addLabelComponents(termsLabel, definitionLabel);

        return modal;
    }

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction, entryId: string): Promise<void> {
        const factManager = guildHolder.getFactManager();
        const entry = await factManager.getFact(entryId);
        if (!entry) {
            await replyEphemeral(interaction, 'Fact entry not found.');
            return;
        }

        const isPrivileged = isEditor(interaction, guildHolder) || isModerator(interaction) || isAdmin(interaction);
        if (!isPrivileged) {
            await replyEphemeral(interaction, 'You do not have permission to edit fact entries.');
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const newTitle = interaction.fields.getTextInputValue('title').trim();
        const newText = interaction.fields.getTextInputValue('text').trim();
        
        entry.page_title = newTitle;
        entry.text = newText;

        await factManager.updateFact(entryId, entry);

        await interaction.editReply('Fact entry updated successfully.');

    }
}
