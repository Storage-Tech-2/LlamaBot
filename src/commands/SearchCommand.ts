import { AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "../interface/Command.js";
import { GuildHolder } from "../GuildHolder.js";
import { replyEphemeral } from "../utils/Util.js";
import { ArchiveIndexEntry } from "../archive/DictionaryManager.js";
import { PostCodePattern } from "../utils/ReferenceUtils.js";

export class SearchCommand implements Command {
    getID(): string {
        return "search";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
            .setName(this.getID())
            .setDescription("Search archived posts by code or name")
            .setContexts(InteractionContextType.Guild)


        data.addStringOption(opt =>
            opt
                .setName("query")
                .setDescription("Post code or name to search for")
                .setRequired(true)
                .setAutocomplete(true)
        );

        return data;
    }

    private async getIndexEntries(guildHolder: GuildHolder): Promise<ArchiveIndexEntry[]> {
        const archiveIndex = await guildHolder.getDictionaryManager().getArchiveIndex();
        return archiveIndex.idToData.values().toArray();
    }

    private rank(entries: ArchiveIndexEntry[], queryRaw: string): ArchiveIndexEntry[] {
        const query = queryRaw.trim().toLowerCase();
        if (!query) return entries;

        // check if query is code
        const isCode = PostCodePattern.test(query);
        const scored = entries.map(entry => {
            let score = 0;
            if (isCode) {
                if (entry.code.toLowerCase() === query) {
                    score += 100;
                } else if (entry.code.toLowerCase().startsWith(query)) {
                    score += 50;
                } else if (entry.code.toLowerCase().includes(query)) {
                    score += 10;
                }
            }

            // check name
            if (entry.name) {
                const nameLower = entry.name.toLowerCase();
                if (nameLower === query) {
                    score += 80;
                } else if (nameLower.startsWith(query)) {
                    score += 40;
                } else if (nameLower.includes(query)) {
                    score += 8;
                }
            }

            return { entry, score };
        }).filter(item => item.score > 0);

        scored.sort((a, b) => b.score - a.score);
        
        return scored.map(item => item.entry);
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild()) {
            await replyEphemeral(interaction, "This command can only be used in a guild.");
            return;
        }

        const query = interaction.options.getString("query", true);
        const entries = await this.getIndexEntries(guildHolder);
        if (entries.length === 0) {
            await replyEphemeral(interaction, "No archived posts found.");
            return;
        }

        const ranked = this.rank(entries, query);
        const match = ranked[0];
        if (!match) {
            await replyEphemeral(interaction, `No archived post found matching "${query}".`);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(match.name ? `${match.code} — ${match.name}` : match.code)
            .setDescription(`Path: ${match.path}`)
            .setURL(match.url)
            .setColor(0x5865f2);

        await interaction.reply({ embeds: [embed] });
    }

    async autocomplete(guildHolder: GuildHolder, interaction: AutocompleteInteraction): Promise<void> {
        const query = interaction.options.getFocused() || "";
        const entries = await this.getIndexEntries(guildHolder);
        const ranked = this.rank(entries, query).slice(0, 25);

        const choices = ranked.map(entry => ({
            name: `${entry.code} — ${entry.path}`.slice(0, 100),
            value: entry.code.slice(0, 100),
        }));

        await interaction.respond(choices);
    }
}
