import { LabelBuilder, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { Modal } from "../../interface/Modal.js";
import { GuildHolder } from "../../GuildHolder.js";
import { isAdmin, isEditor, isModerator, replyEphemeral } from "../../utils/Util.js";
import { QAFactSheet } from "../../archive/PrivateFactBase.js";

export class FactEditModal implements Modal {
    getID(): string {
        return "facteditmodal";
    }

    async getBuilder(identifier: string, entry: QAFactSheet): Promise<ModalBuilder> {
        const modal = new ModalBuilder()
            .setCustomId(`${this.getID()}|${identifier}`)
            .setTitle('Edit Fact Entry');

        const questionInput = new TextInputBuilder()
            .setCustomId('question')
            .setRequired(true)
            .setStyle(TextInputStyle.Paragraph)
            .setValue(entry.question || '');

        const questionLabel = new LabelBuilder()
            .setLabel('Question:')
            .setTextInputComponent(questionInput);

        const answerInput = new TextInputBuilder()
            .setCustomId('answer')
            .setRequired(false)
            .setStyle(TextInputStyle.Paragraph)
            .setValue(entry.answer || '');

        const answerLabel = new LabelBuilder()
            .setLabel('Answer:')
            .setTextInputComponent(answerInput);

        modal.addLabelComponents(questionLabel, answerLabel);
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

        await interaction.deferReply();

        const newQuestion = interaction.fields.getTextInputValue('question').trim();
        const newAnswer = interaction.fields.getTextInputValue('answer').trim();
        const oldQuestion = entry.question || '';
        entry.question = newQuestion;
        entry.answer = newAnswer;

        await factManager.updateFact(entryId, entry);

        await interaction.editReply(`<@${interaction.user.id}> updated fact entry ${oldQuestion !== newQuestion ? ` ${oldQuestion} -> ${newQuestion}` : newQuestion}.`);
    }
}
