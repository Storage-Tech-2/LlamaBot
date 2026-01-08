import { AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { Command } from "../interface/Command.js";
import { GuildHolder } from "../GuildHolder.js";
import { getAuthorsString, replyEphemeral, truncateStringWithEllipsis } from "../utils/Util.js";
import { PostCodePattern, transformOutputWithReferencesForDiscord } from "../utils/ReferenceUtils.js";
import { ArchiveIndexEntry } from "../archive/IndexManager.js";

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
        const isCode = /[a-z]+[0-9]{0,3}/i.test(query);
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
        // test code pattern
        const isCode = PostCodePattern.test(query);
        let entryData = null;
        if (isCode) {
            const entry = await guildHolder.getRepositoryManager().getEntryByPostCode(query);
            if (entry) {
                entryData = entry.entry.getData();
            }
        }

        if (!entryData) {
            const entries = await this.getIndexEntries(guildHolder);
            const ranked = this.rank(entries, query);
            if (ranked.length > 0) {
                const entry = await guildHolder.getRepositoryManager().getEntryByPostCode(ranked[0].code);
                if (entry) {
                    entryData = entry.entry.getData();
                }
            }
        }

        if (!entryData) {
            await interaction.reply({ content: `No results found for "${query}".`, ephemeral: true });
            return;
        }

        const name = entryData.code + ': ' + entryData.name;
        const authors = getAuthorsString(entryData.authors);
        const tags = entryData.tags.map(tag => tag.name).join(', ');
        const description = entryData.records.description as string || '';
        const image = entryData.images.length > 0 ? entryData.images[0].url : null;

        const textArr = [
            `**Authors:** ${authors}`,
            `**Tags:** ${tags || 'None'}`,
        ];
        if (description) {
            textArr.push('\n' + transformOutputWithReferencesForDiscord(description, entryData.references));
        }

        const embed = new EmbedBuilder()
            .setTitle(truncateStringWithEllipsis(name, 256))
            .setDescription(truncateStringWithEllipsis(textArr.join('\n'), 500))
            .setColor(0x00AE86)
            .setURL(entryData.post?.threadURL || '');
        if (image) {
            embed.setThumbnail(image);
        }

        await interaction.reply({ 
            embeds: [embed],
            flags: [MessageFlags.SuppressNotifications],
            allowedMentions: { parse: [] }
        });
    }

    async autocomplete(guildHolder: GuildHolder, interaction: AutocompleteInteraction): Promise<void> {
        const query = interaction.options.getFocused() || "";
        const entries = await this.getIndexEntries(guildHolder);
        const ranked = this.rank(entries, query).slice(0, 25);

        const choices = ranked.map(entry => ({
            name: `${entry.code} — ${entry.name}`.slice(0, 100),
            value: entry.code.slice(0, 100),
        }));

        await interaction.respond(choices);
    }
}
