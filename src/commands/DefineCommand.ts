import { AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { DictionaryEntry } from "../archive/DictionaryManager.js";
import { MarkdownCharacterRegex } from "../utils/ReferenceUtils.js";
import { replyEphemeral, splitIntoChunks } from "../utils/Util.js";
import { BasicDictionaryIndexEntry } from "../archive/IndexManager.js";

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

    private rankTermEntries(terms: BasicDictionaryIndexEntry[], query: string): { termsRanked: { term: string, score: number }[]; term: BasicDictionaryIndexEntry; score: number }[] {
        const scoredTerms = terms.map(term => {
            let score = 0;
            const ranked = this.rankTerms(term.terms, query);
            if (ranked.length > 0) {
                score = ranked[0].score;
            }
            return {
                termsRanked: ranked,
                term: term,
                score
            };
        }).filter(entry => entry.score > 0);
        scoredTerms.sort((a, b) => b.score - a.score);
        return scoredTerms;
    }

    private rankTerms(terms: string[], query: string): { term: string, score: number }[] {
        const normalizedQuery = this.normalizeTerm(query);

        const scoredTerms = terms.map(term => {
            const normalizedTerm = this.normalizeTerm(term);
            let score = 0;
            if (normalizedTerm === normalizedQuery) {
                score += 100;
            } else if (normalizedTerm.startsWith(normalizedQuery)) {
                score += 50;
            } else if (normalizedTerm.includes(normalizedQuery)) {
                score += 10;
            }
            return { term, score };
        }).filter(entry => entry.score > 0);

        scoredTerms.sort((a, b) => b.score - a.score);

        return scoredTerms;
    }

    private findBestMatch(query: string, terms: BasicDictionaryIndexEntry[]): { termsRanked: { term: string, score: number }[]; term: BasicDictionaryIndexEntry; score: number } | null {
        if (terms.length === 0) {
            return null;
        }

        const ranked = this.rankTermEntries(terms, query);
        return ranked.length > 0 ? ranked[0] : null;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild()) {
            await replyEphemeral(interaction, "This command can only be used in a guild.");
            return;
        }

        const termId = interaction.options.getString("term", true);
        // check if id
        let entry: DictionaryEntry | null = null;
        if (/^[0-9]{17,19}$/.test(termId)) {
            entry = await guildHolder.getDictionaryManager().getEntry(termId);
        } else {
            const terms = await guildHolder.getDictionaryManager().getBasicDictionaryIndex();
            const match = this.findBestMatch(termId, terms);
            if (match) {
                entry = await guildHolder.getDictionaryManager().getEntry(match.term.id);
            }
        }

        if (!entry) {
            await replyEphemeral(interaction, `No definition found for "${termId}".`);
            return;
        }

        const url = entry.statusURL || entry.threadURL || "";
        const definitionSplit = splitIntoChunks(entry.definition, 4000);

        const closestMatchTerm = this.rankTerms(entry.terms, termId)[0]?.term || entry.terms[0];
        for (let i = 0; i < definitionSplit.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle(closestMatchTerm)
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
        const terms = (await guildHolder.getDictionaryManager().getBasicDictionaryIndex());
        const ranked = this.rankTermEntries(terms, focused).slice(0, 25);

        const choices = ranked.map(term => ({
            name: term.termsRanked.map(t => t.term).join(", "),
            value: term.term.id
        }));

        await interaction.respond(choices);
    }
}
