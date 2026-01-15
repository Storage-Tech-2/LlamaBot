import { ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { Command } from "../interface/Command.js";
import { GuildHolder } from "../GuildHolder.js";
import { getAuthorsString, replyEphemeral, splitIntoChunks, truncateStringWithEllipsis } from "../utils/Util.js";
import { transformOutputWithReferencesForDiscord } from "../utils/ReferenceUtils.js";
import { base64ToInt8Array, computeSimilarities, generateQueryEmbeddings } from "../llm/EmbeddingUtils.js";
import { RepositoryConfigs } from "../archive/RepositoryConfigs.js";

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
        const channels = guildHolder.getRepositoryManager().getConfigManager().getConfig(RepositoryConfigs.ARCHIVE_CHANNELS).filter(c => c.embedding);

        const dictionaryEmbeddingVectors = dictionaryEmbeddings.map(e => base64ToInt8Array(e.embedding));
        const repositoryEmbeddingVectors = repositoryEmbeddings.map(e => base64ToInt8Array(e.embedding));
        const channelEmbeddingVectors = channels.map(c => base64ToInt8Array(c.embedding!));

        const dictionaryScores = computeSimilarities(queryEmbedding, dictionaryEmbeddingVectors);
        const repositoryScores = computeSimilarities(queryEmbedding, repositoryEmbeddingVectors);
        const channelScores = computeSimilarities(queryEmbedding, channelEmbeddingVectors);

        // combine and sort
        type ScoredEntry = {
            score: number;
            source: "dictionary" | "repository" | "channel";
            codeOrId: string;
        };
        const dictionaryScored: ScoredEntry[] = [];
        const repositoryScored: ScoredEntry[] = [];
        const channelScored: ScoredEntry[] = [];
        for (let i = 0; i < dictionaryScores.length; i++) {
            dictionaryScored.push({
                score: dictionaryScores[i],
                source: "dictionary",
                codeOrId: dictionaryEmbeddings[i].id
            });
        }
        for (let i = 0; i < repositoryScores.length; i++) {
            repositoryScored.push({
                score: repositoryScores[i],
                source: "repository",
                codeOrId: repositoryEmbeddings[i].code
            });
        }

        for (let i = 0; i < channelScores.length; i++) {
            channelScored.push({
                score: channelScores[i],
                source: "channel",
                codeOrId: channels[i].id
            });
        }

        //combinedScores.sort((a, b) => b.score - a.score);

        const getHighestScoredItem = (list: ScoredEntry[]) => {
            return list.reduce((prev, current) => (prev && prev.score > current.score) ? prev : current, null as ScoredEntry | null);
        }



        // dictionaryScored.sort((a, b) => b.score - a.score);
        // repositoryScored.sort((a, b) => b.score - a.score);
        // channelScored.sort((a, b) => b.score - a.score);

        const topDictionary = getHighestScoredItem(dictionaryScored);
        const topRepository = getHighestScoredItem(repositoryScored);
        const topChannel = getHighestScoredItem(channelScored);

        // take top 3
        // const topEntries = combinedScores.slice(0, 1);

        const topEntries: ScoredEntry[] = [];
        if (topChannel) topEntries.push(topChannel);
        if (topDictionary) topEntries.push(topDictionary);
        if (topRepository) topEntries.push(topRepository);

        const embeds = [];

        for (const entry of topEntries) {
            if (entry.source === "dictionary") {
                const dictEntry = await guildHolder.getDictionaryManager().getEntry(entry.codeOrId);
                if (!dictEntry) continue;

                const definitionSplit = splitIntoChunks(transformOutputWithReferencesForDiscord(dictEntry.definition, dictEntry.references), 4000);
                const url = dictEntry.statusURL || dictEntry.threadURL || "";

                const closestMatchTerm = dictEntry.terms[0];
                for (let i = 0; i < definitionSplit.length; i++) {
                    const embed = new EmbedBuilder()
                        .setTitle(truncateStringWithEllipsis(`Term: ` + closestMatchTerm, 256))
                        .setDescription(definitionSplit[i])
                        .setColor(0x2d7d46);

                    if (definitionSplit.length > 1) {
                        embed.setFooter({ text: `Part ${i + 1} of ${definitionSplit.length}` });
                    }

                    if (url) {
                        embed.setURL(url);
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
                    .setDescription(truncateStringWithEllipsis(textArr.join('\n'), 4000))
                    .setColor(0x00AE86)
                    .setURL(entryData.post?.threadURL || '');
                if (image) {
                    embed.setThumbnail(image);
                }

                embeds.push(embed);
            } else if (entry.source === "channel") {
                const channel = channels.find(c => c.id === entry.codeOrId);
                if (!channel) continue;

                const embed = new EmbedBuilder()
                    .setTitle(truncateStringWithEllipsis(`Channel: ` + channel.name, 256))
                    .setDescription(truncateStringWithEllipsis(channel.description, 4000))
                    .setColor(0x0099ff);

                const url = `https://discord.com/channels/${guildHolder.getGuildId()}/${channel.id}`;
                embed.setURL(url);

                embeds.push(embed);
            }
        }

        if (embeds.length === 0) {
            await interaction.editReply({
                content: "No relevant entries found in the archive."
            });
            return;
        }

        await interaction.editReply({
            content: truncateStringWithEllipsis(`You asked: \`${question}\`\nHere are the most relevant entries I found:`, 2000),
            allowedMentions: { parse: [] }
        });

        // each embed gets its own message if more than 1
        for (let i = 0; i < embeds.length; i++) {
            await interaction.channel.send({
                embeds: [embeds[i]],
                flags: [MessageFlags.SuppressNotifications],
                allowedMentions: { parse: [] }
            });
        }
    }
}
