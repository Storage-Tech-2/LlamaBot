import { ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { Command } from "../interface/Command.js";
import { GuildHolder } from "../GuildHolder.js";
import { getAuthorsString, isAdmin, replyEphemeral, splitIntoChunks, truncateStringWithEllipsis } from "../utils/Util.js";
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

        const isCalledByAdmin = isAdmin(interaction);

        // get indexess
        const channels = guildHolder.getRepositoryManager().getConfigManager().getConfig(RepositoryConfigs.ARCHIVE_CHANNELS).filter(c => c.embedding);
        const channelEmbeddingVectors = channels.map(c => base64ToInt8Array(c.embedding!));

        const dictionaryResults = await guildHolder.getDictionaryManager().getClosest(queryEmbedding, 1);
        const repositoryResults = await guildHolder.getRepositoryManager().getClosest(queryEmbedding, 1);
        const factBaseResults = isCalledByAdmin ? await guildHolder.getFactManager().getClosest(queryEmbedding, 1) : [];
        const channelDistances = computeSimilarities(queryEmbedding, channelEmbeddingVectors);

        // combine and sort
        type ScoredEntry = {
            distance: number;
            source: "dictionary" | "repository" | "channel" | "factbase";
            identifier: string;
        };

        const dictionaryScored: ScoredEntry[] = [];
        const repositoryScored: ScoredEntry[] = [];
        const channelScored: ScoredEntry[] = [];
        const factBaseScored: ScoredEntry[] = [];
        for (let i = 0; i < dictionaryResults.length; i++) {
            dictionaryScored.push({
                distance: dictionaryResults[i].distance,
                source: "dictionary",
                identifier: dictionaryResults[i].identifier
            });
        }
        for (let i = 0; i < repositoryResults.length; i++) {
            repositoryScored.push({
                distance: repositoryResults[i].distance,
                source: "repository",
                identifier: repositoryResults[i].identifier
            });
        }

        for (let i = 0; i < channelDistances.length; i++) {
            channelScored.push({
                distance: channelDistances[i],
                source: "channel",
                identifier: channels[i].id
            });
        }

        for (let i = 0; i < factBaseResults.length; i++) {
            factBaseScored.push({
                distance: factBaseResults[i].distance,
                source: "factbase",
                identifier: factBaseResults[i].identifier
            });
        }

        //combinedScores.sort((a, b) => b.score - a.score);

        const getHighestScoredItem = (list: ScoredEntry[]) => {
            return list.reduce((prev, current) => (prev && prev.distance > current.distance) ? prev : current, null as ScoredEntry | null);
        }



        // dictionaryScored.sort((a, b) => b.score - a.score);
        // repositoryScored.sort((a, b) => b.score - a.score);
        // channelScored.sort((a, b) => b.score - a.score);

        const topDictionary = getHighestScoredItem(dictionaryScored);
        const topRepository = getHighestScoredItem(repositoryScored);
        const topChannel = getHighestScoredItem(channelScored);
        const topFactBase = getHighestScoredItem(factBaseScored);

        // take top 3
        // const topEntries = combinedScores.slice(0, 1);

        const topEntries: ScoredEntry[] = [];
        if (topChannel) topEntries.push(topChannel);
        if (topDictionary) topEntries.push(topDictionary);
        if (topRepository) topEntries.push(topRepository);
        if (topFactBase) topEntries.push(topFactBase);

        const embeds = [];

        for (const entry of topEntries) {
            if (entry.source === "dictionary") {
                const dictEntry = await guildHolder.getDictionaryManager().getEntry(entry.identifier);
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
                const repoEntry = await guildHolder.getRepositoryManager().getEntryByPostCode(entry.identifier);
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
                const channel = channels.find(c => c.id === entry.identifier);
                if (!channel) continue;

                const embed = new EmbedBuilder()
                    .setTitle(truncateStringWithEllipsis(`Channel: ` + channel.name, 256))
                    .setDescription(truncateStringWithEllipsis(channel.description, 4000))
                    .setColor(0x0099ff);

                const url = `https://discord.com/channels/${guildHolder.getGuildId()}/${channel.id}`;
                embed.setURL(url);

                embeds.push(embed);
            } else if (entry.source === "factbase") {
                const factEntry = await guildHolder.getFactManager().getFact(entry.identifier);
                if (!factEntry) continue;

                // first parse citations [QAxx]
                let text = factEntry.text;
                factEntry.cited.forEach(citation => {
                    const url = `https://discord.com/channels/748542142347083868/748549293433946133/${citation.message_ids[0]}`;
                    text = text.replaceAll(`[QA${citation.number}]`, `[[QA${citation.number}]](${url})`);
                });

                const textSplit = splitIntoChunks(text, 4000);
                for (let i = 0; i < textSplit.length; i++) {
                    const embed = new EmbedBuilder()
                        .setTitle(truncateStringWithEllipsis(`Fact: ` + factEntry.page_title, 256))
                        .setDescription(textSplit[i])
                        .setColor(0x8B4513);

                    if (textSplit.length > 1) {
                        embed.setFooter({ text: `Part ${i + 1} of ${textSplit.length}` });
                    }
                    embeds.push(embed);
                }
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
