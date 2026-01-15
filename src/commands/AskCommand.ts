import { AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { Command } from "../interface/Command.js";
import { GuildHolder } from "../GuildHolder.js";
import { getAuthorsString, replyEphemeral, splitIntoChunks, truncateStringWithEllipsis } from "../utils/Util.js";
import { PostCodePattern, transformOutputWithReferencesForDiscord } from "../utils/ReferenceUtils.js";
import { ArchiveIndexEntry } from "../archive/IndexManager.js";
import { base64ToInt8Array, computeSimilarities, generateQueryEmbeddings } from "../llm/EmbeddingUtils.js";

export class AskCommand implements Command {
    getID(): string {
        return "ask";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
            .setName(this.getID())
            .setDescription("Ask a question to the archive")
            .setContexts(InteractionContextType.Guild)


        data.addStringOption(opt =>
            opt
                .setName("question")
                .setDescription("Your question")
                .setRequired(true)
        );

        return data;
    }
    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild()) {
            await replyEphemeral(interaction, "This command can only be used in a guild.");
            return;
        }

        const question = interaction.options.getString("question", true).trim();

        if (question.length === 0) {
            await replyEphemeral(interaction, "Please provide a valid question.");
            return;
        }

        if (!interaction.channel?.isSendable()) {
            await replyEphemeral(interaction, "I cannot send messages in this channel.");
            return;
        }

        // defer reply
        await interaction.deferReply();

        // generate embedding
        const embedding = await generateQueryEmbeddings([question]).catch((e) => {
            console.error("Error generating query embedding:", e);
            return null;
        });

        if (!embedding || embedding.embeddings.length === 0) {
            await interaction.editReply({
                content: "There was an error processing your question. Please try again later."
            });
            return;
        }

        const queryEmbedding = base64ToInt8Array(embedding.embeddings[0]);

        // get indexes
        const dictionaryEmbeddings = await guildHolder.getDictionaryManager().getEmbeddings();
        const repositoryEmbeddings = await guildHolder.getRepositoryManager().getEmbeddings();

        const dictionaryEmbeddingVectors = dictionaryEmbeddings.map(e => base64ToInt8Array(e.embedding));
        const repositoryEmbeddingVectors = repositoryEmbeddings.map(e => base64ToInt8Array(e.embedding));

        const dictionaryScores = computeSimilarities(queryEmbedding, dictionaryEmbeddingVectors);
        const repositoryScores = computeSimilarities(queryEmbedding, repositoryEmbeddingVectors);

        // combine and sort
        type ScoredEntry = {
            score: number;
            source: "dictionary" | "repository";
            codeOrId: string;
        };
        const combinedScores: ScoredEntry[] = [];
        for (let i = 0; i < dictionaryScores.length; i++) {
            combinedScores.push({
                score: dictionaryScores[i],
                source: "dictionary",
                codeOrId: dictionaryEmbeddings[i].id
            });
        }
        for (let i = 0; i < repositoryScores.length; i++) {
            combinedScores.push({
                score: repositoryScores[i],
                source: "repository",
                codeOrId: repositoryEmbeddings[i].code
            });
        }

        combinedScores.sort((a, b) => b.score - a.score);

        // take top 3
        const topEntries = combinedScores.slice(0, 3);

        const embeds = [];

        for (const entry of topEntries) {
            if (entry.source === "dictionary") {
                const dictEntry = await guildHolder.getDictionaryManager().getEntry(entry.codeOrId);
                if (!dictEntry) continue;

                const definitionSplit = splitIntoChunks(transformOutputWithReferencesForDiscord(dictEntry.definition, dictEntry.references), 4000);

                const closestMatchTerm = dictEntry.terms[0];
                for (let i = 0; i < definitionSplit.length; i++) {
                    const embed = new EmbedBuilder()
                        .setTitle(truncateStringWithEllipsis(closestMatchTerm, 256))
                        .setDescription(definitionSplit[i])
                        .setColor(0x2d7d46);

                    if (definitionSplit.length > 1) {
                        embed.setFooter({ text: `Part ${i + 1} of ${definitionSplit.length}` });
                    }
                    embeds.push(embed);
                }

            } else if (entry.source === "repository") {
                const repoEntry = await guildHolder.getRepositoryManager().getEntryByPostCode(entry.codeOrId);
                if (!repoEntry) continue;

                const entryData = repoEntry.entry.getData();

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

                embeds.push(embed);
            }
        }

        if (embeds.length === 0) {
            await interaction.editReply({
                content: "No relevant entries found in the archive."
            });
            return;
        }

        // each embed gets its own message if more than 1
        for (let i = 0; i < embeds.length; i++) {
            if (i === 0) {
                await interaction.editReply({
                    embeds: [embeds[i]],
                    allowedMentions: { parse: [] }
                });
            } else {
                await interaction.channel.send({
                    embeds: [embeds[i]],
                    flags: [MessageFlags.SuppressNotifications],
                    allowedMentions: { parse: [] }
                });
            }
        }
    }
}
