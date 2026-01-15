import { EmbedBuilder, LabelBuilder, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { Modal } from "../../interface/Modal.js";
import { GuildHolder } from "../../GuildHolder.js";
import { DictionaryEntry, DictionaryEntryStatus } from "../../archive/DictionaryManager.js";
import { isEditor, isModerator, replyEphemeral, truncateStringWithEllipsis } from "../../utils/Util.js";
import { GuildConfigs } from "../../config/GuildConfigs.js";
import { tagReferences, transformOutputWithReferencesForDiscord } from "../../utils/ReferenceUtils.js";

export class DictionaryEditModal implements Modal {
    getID(): string {
        return "dictionaryeditmodal";
    }

    async getBuilder(entry: DictionaryEntry): Promise<ModalBuilder> {
        const modal = new ModalBuilder()
            .setCustomId(`${this.getID()}|${entry.id}`)
            .setTitle('Edit Dictionary Entry');

        const termsInput = new TextInputBuilder()
            .setCustomId('terms')
            .setRequired(false)
            .setStyle(TextInputStyle.Short)
            .setValue(entry.terms.join(', '));

        const termsLabel = new LabelBuilder()
            .setLabel('Terms (comma-separated):')
            .setTextInputComponent(termsInput);

        const definitionInput = new TextInputBuilder()
            .setCustomId('definition')
            .setRequired(false)
            .setStyle(TextInputStyle.Paragraph)
            .setValue(entry.definition || '');

        const definitionLabel = new LabelBuilder()
            .setLabel('Definition:')
            .setTextInputComponent(definitionInput);

        modal.addLabelComponents(termsLabel, definitionLabel);

        return modal;
    }

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction, entryId: string): Promise<void> {
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

        const oldTerms = [...entry.terms];
        const oldDefinition = entry.definition;

        const termsInput = interaction.fields.getTextInputValue('terms');
        const definitionInput = interaction.fields.getTextInputValue('definition');

        let updated = false;

        if (termsInput !== undefined) {
            const parsedTerms = termsInput.split(',').map(t => t.trim()).filter(Boolean);
            if (parsedTerms.length > 0) {
                entry.terms = parsedTerms;
                updated = true;
                const newName = truncateStringWithEllipsis(entry.terms.join(', '), 100);
                if (newName && thread.name !== newName) {
                    await thread.setName(newName).catch(() => { /* ignore rename errors */ });
                }
            }
        }

        let retag = false;
        if (definitionInput !== undefined && definitionInput !== entry.definition) {
            entry.definition = definitionInput;
            updated = true;
            retag = true;
        }

        if (!updated) {
            await replyEphemeral(interaction, 'No changes were applied.');
            return;
        }

        await interaction.deferReply();
        if (retag) {
            entry.references = await tagReferences(entry.definition, entry.references, guildHolder, entry.id);
        }

        entry.updatedAt = Date.now();
        await dictionaryManager.saveEntryAndPush(entry);
        await dictionaryManager.updateStatusMessage(entry, thread);
        await dictionaryManager.warnIfDuplicate(entry, thread);

        const fields = [];
        if (oldTerms.join(', ') !== entry.terms.join(', ')) {
            fields.push({
                name: 'Terms',
                value: `**Before:** ${truncateStringWithEllipsis(oldTerms.join(', ') || 'None', 1000)}\n**After:** ${truncateStringWithEllipsis(entry.terms.join(', ') || 'None', 1000)}`
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('Dictionary Entry Updated')
            .setColor(0x0099ff)
            .addFields(fields)
            .setFooter({ text: `Updated by ${interaction.user.tag}` })
            .setTimestamp(new Date(entry.updatedAt));
        if (entry.definition !== oldDefinition) {
            embed.setDescription(truncateStringWithEllipsis(transformOutputWithReferencesForDiscord(entry.definition || 'No definition', entry.references), 3500));
        }

        await interaction.editReply({
            content: `<@${interaction.user.id}> updated this dictionary entry.`,
            embeds: [embed],
            allowedMentions: { parse: [] },
        }).catch(() => { /* ignore send errors */ });

    }
}
