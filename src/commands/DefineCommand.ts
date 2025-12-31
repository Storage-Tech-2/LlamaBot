import { AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { DictionaryEntry, DictionaryEntryStatus } from "../archive/DictionaryManager.js";
import { MarkdownCharacterRegex } from "../utils/ReferenceUtils.js";
import { replyEphemeral, splitIntoChunks, truncateStringWithEllipsis } from "../utils/Util.js";

type TermEntry = {
    term: string;
    normalized: string;
    entry: DictionaryEntry;
};

export class DefineCommand implements Command {
    getID(): string {
        return "define";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder();
        data.setName(this.getID())
            .setDescription("Look up a dictionary definition")
            .setContexts(InteractionContextType.Guild);

        data.addStringOption(option =>
            option
                .setName("term")
                .setDescription("Dictionary term to define")
                .setRequired(true)
                .setAutocomplete(true)
        );

        return data;
    }

    private normalizeTerm(term: string): string {
        return term.toLowerCase().replace(MarkdownCharacterRegex, "").trim();
    }

    private buildTermList(entries: DictionaryEntry[]): TermEntry[] {
        const seen = new Set<string>();
        const list: TermEntry[] = [];

        for (const entry of entries) {
            for (const term of entry.terms || []) {
                const normalized = this.normalizeTerm(term);
                if (!normalized) {
                    continue;
                }

                const key = `${entry.id}:${normalized}`;
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                list.push({ term, normalized, entry });
            }
        }

        return list;
    }

    private rankTerms(terms: TermEntry[], query: string): TermEntry[] {
        const normalizedQuery = this.normalizeTerm(query);
        const filtered = normalizedQuery
            ? terms.filter(term => term.normalized.includes(normalizedQuery))
            : terms;

        filtered.sort((a, b) => {
            const aStarts = normalizedQuery ? (a.normalized.startsWith(normalizedQuery) ? 1 : 0) : 0;
            const bStarts = normalizedQuery ? (b.normalized.startsWith(normalizedQuery) ? 1 : 0) : 0;
            if (aStarts !== bStarts) {
                return bStarts - aStarts;
            }

            if (a.entry.updatedAt !== b.entry.updatedAt) {
                return b.entry.updatedAt - a.entry.updatedAt;
            }

            return a.term.localeCompare(b.term);
        });

        return filtered;
    }

    private findBestMatch(query: string, terms: TermEntry[]): TermEntry | null {
        if (terms.length === 0) {
            return null;
        }

        const normalizedQuery = this.normalizeTerm(query);
        if (!normalizedQuery) {
            return terms[0];
        }

        const exact = terms.find(term => term.normalized === normalizedQuery);
        if (exact) {
            return exact;
        }

        const ranked = this.rankTerms(terms, query);
        return ranked.length > 0 ? ranked[0] : null;
    }

    private async getApprovedTerms(guildHolder: GuildHolder): Promise<TermEntry[]> {
        const entries = await guildHolder.getDictionaryManager().listEntries();
        const approved = entries.filter(entry => entry.status === DictionaryEntryStatus.APPROVED);
        return this.buildTermList(approved);
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild()) {
            await replyEphemeral(interaction, "This command can only be used in a guild.");
            return;
        }

        const query = interaction.options.getString("term", true);
        const terms = await this.getApprovedTerms(guildHolder);

        if (terms.length === 0) {
            await replyEphemeral(interaction, "No approved dictionary entries found.");
            return;
        }

        const match = this.findBestMatch(query, terms);
        if (!match) {
            await replyEphemeral(interaction, `No definition found for "${query}".`);
            return;
        }

        const definition = match.entry.definition?.trim() || "No definition available.";
        const url = match.entry.threadURL || match.entry.statusURL || "";
        const definitionSplit = splitIntoChunks(definition, 4000);

        for (let i = 0; i < definitionSplit.length - 1; i++) {
            const embed = new EmbedBuilder()
                .setTitle(match.term)
                .setDescription(definitionSplit[i])
                .setColor(0x2d7d46);

            if (definitionSplit.length > 1) {
                embed.setFooter({ text: `Part ${i + 1} of ${definitionSplit.length}` });
            }

            if (url) {
                embed.setURL(url);
            }

            if (i === 0) {
                await interaction.reply({ embeds: [embed] });
            } else {
                await interaction.followUp({ embeds: [embed] });
            }
        }
    }

    async autocomplete(guildHolder: GuildHolder, interaction: AutocompleteInteraction): Promise<void> {
        const focused = interaction.options.getFocused() || "";
        const terms = await this.getApprovedTerms(guildHolder);
        const ranked = this.rankTerms(terms, focused).slice(0, 25);

        const choices = ranked.map(term => ({
            name: truncateStringWithEllipsis(`${term.term} — ${term.entry.definition.replace(/\s+/g, " ")}`, 100),
            value: term.term.slice(0, 100),
        }));

        await interaction.respond(choices);
    }
}
