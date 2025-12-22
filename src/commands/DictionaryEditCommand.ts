import { AnyThreadChannel, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { DictionaryEntryStatus } from "../dictionary/DictionaryManager.js";
import { isEditor, isModerator, replyEphemeral } from "../utils/Util.js";

export class DictionaryEditCommand implements Command {
    getID(): string {
        return "dictionaryedit";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder();
        data
            .setName(this.getID())
            .setDescription('Edit or approve a dictionary entry')
            .setContexts(InteractionContextType.Guild)
            .addStringOption(option =>
                option
                    .setName('terms')
                    .setDescription('Comma-separated list of terms for this entry')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option
                    .setName('definition')
                    .setDescription('Updated dictionary definition')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option
                    .setName('status')
                    .setDescription('Set the status of this dictionary entry')
                    .setRequired(false)
                    .addChoices(
                        { name: 'Pending', value: DictionaryEntryStatus.PENDING },
                        { name: 'Approved', value: DictionaryEntryStatus.APPROVED },
                        { name: 'Rejected', value: DictionaryEntryStatus.REJECTED },
                    )
            );
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild() || !interaction.channel || !interaction.channel.isThread()) {
            await replyEphemeral(interaction, 'This command can only be used inside a dictionary thread.');
            return;
        }

        const dictionaryChannelId = guildHolder.getConfigManager().getConfig(GuildConfigs.DICTIONARY_CHANNEL_ID);
        if (!dictionaryChannelId) {
            await replyEphemeral(interaction, 'Dictionary channel is not configured.');
            return;
        }

        if (interaction.channel.parentId !== dictionaryChannelId) {
            await replyEphemeral(interaction, 'This command can only be used inside a dictionary thread.');
            return;
        }

        if (!isEditor(interaction, guildHolder) && !isModerator(interaction)) {
            await replyEphemeral(interaction, 'You do not have permission to use this command.');
            return;
        }

        const termsInput = interaction.options.getString('terms');
        const definition = interaction.options.getString('definition');
        const status = interaction.options.getString('status') as DictionaryEntryStatus | null;

        if (!termsInput && definition === null && !status) {
            await replyEphemeral(interaction, 'Provide at least one field to update.');
            return;
        }

        const dictionaryManager = guildHolder.getDictionaryManager();
        const thread = interaction.channel as AnyThreadChannel;
        const entry = await dictionaryManager.ensureEntryForThread(thread);
        if (!entry) {
            await replyEphemeral(interaction, 'Could not load a dictionary entry for this thread.');
            return;
        }

        const previousTerms = [...entry.terms];
        let updated = false;

        if (termsInput) {
            const parsedTerms = termsInput.split(',').map(term => term.trim()).filter(term => term.length > 0);
            if (parsedTerms.length > 0) {
                entry.terms = parsedTerms;
                updated = true;
                const newName = parsedTerms[0];
                if (newName && thread.name !== newName) {
                    await thread.setName(newName).catch(() => { /* ignore rename errors */ });
                }
            }
        }

        if (definition !== null) {
            entry.definition = definition;
            updated = true;
        }

        if (status) {
            entry.status = status;
            updated = true;
        }

        if (!updated) {
            await replyEphemeral(interaction, 'No changes were applied.');
            return;
        }

        entry.updatedAt = Date.now();
        await dictionaryManager.saveEntry(entry, previousTerms);
        await dictionaryManager.updateStatusMessage(entry, thread);
        await dictionaryManager.warnIfDuplicate(entry, thread);

        await interaction.reply({ content: 'Dictionary entry updated.', ephemeral: true });
    }
}
