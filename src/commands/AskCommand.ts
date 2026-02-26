import { ActionRowBuilder, ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { Command } from "../interface/Command.js";
import { GuildHolder } from "../GuildHolder.js";
import { getAuthorsString, isAdmin, replyEphemeral, splitIntoChunks, truncateStringWithEllipsis } from "../utils/Util.js";
import { transformOutputWithReferencesForDiscord } from "../utils/ReferenceUtils.js";
import { base64ToInt8Array, computeSimilarities, generateQueryEmbeddings } from "../llm/EmbeddingUtils.js";
import { EditFactButton } from "../components/buttons/EditFactButton.js";

type DatabaseChoice = "all" | "dictionary" | "repository" | "channel" | "factbase";

export class AskCommand implements Command {
    getID(): string {
        return "ask";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
            .setName(this.getID())
            .setDescription("Ask a question to the archive")
            .setContexts(InteractionContextType.Guild)
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)


        data.addStringOption(opt =>
            opt
                .setName("question")
                .setDescription("Your question")
                .setRequired(true)
        );
        data.addStringOption(opt =>
            opt
                .setName("database")
                .setDescription("Which database to search")
                .addChoices(
                    { name: "All", value: "all" },
                    { name: "Dictionary", value: "dictionary" },
                    { name: "Repository", value: "repository" },
                    { name: "Channels", value: "channel" },
                    { name: "Fact base (admins only)", value: "factbase" },
                )
        );
        data.addIntegerOption(opt =>
            opt
                .setName("limit")
                .setDescription("How many results to return (max 5)")
                .setMinValue(1)
                .setMaxValue(5)
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

        const databaseChoice = (interaction.options.getString("database") as DatabaseChoice | null) ?? "all";
        const requestedLimit = interaction.options.getInteger("limit");
        const isCalledByAdmin = isAdmin(interaction);

        if (databaseChoice === "factbase" && !isCalledByAdmin) {
            await replyEphemeral(interaction, "You must be an admin to search the fact base.");
            return;
        }

        const defaultLimit = databaseChoice === "all" ? 4 : 1;
        const maxResults = Math.min(Math.max(requestedLimit ?? defaultLimit, 1), 5);

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

        // get indexess
        const channels = (await guildHolder.getRepositoryManager().getChannelReferences()).filter(c => c.embedding);
        const channelEmbeddingVectors = channels.map(c => base64ToInt8Array(c.embedding!));

        type ScoredEntry = {
            distance: number;
            score: number;
            source: "dictionary" | "repository" | "channel" | "factbase";
            identifier: string;
        };

        const sourcesToSearch: DatabaseChoice[] = databaseChoice === "all"
            ? ["dictionary", "repository", "channel", ...(isCalledByAdmin ? ["factbase"] as const : [])]
            : [databaseChoice];

        const scoredEntries: ScoredEntry[] = [];

        if (sourcesToSearch.includes("dictionary")) {
            const dictionaryResults = await guildHolder.getDictionaryManager().getClosest(queryEmbedding, maxResults);
            dictionaryResults.forEach(result => {
                scoredEntries.push({
                    distance: result.distance,
                    score: 1 - result.distance,
                    source: "dictionary",
                    identifier: result.identifier
                });
            });
        }

        if (sourcesToSearch.includes("repository")) {
            const repositoryResults = await guildHolder.getRepositoryManager().getClosest(queryEmbedding, maxResults);
            repositoryResults.forEach(result => {
                scoredEntries.push({
                    distance: result.distance,
                    score: 1 - result.distance,
                    source: "repository",
                    identifier: result.identifier
                });
            });
        }

        if (sourcesToSearch.includes("factbase") && isCalledByAdmin) {
            const factBaseResults = await guildHolder.getFactManager().getClosest(queryEmbedding, maxResults);
            factBaseResults.forEach(result => {
                scoredEntries.push({
                    distance: result.distance,
                    score: 1 - result.distance,
                    source: "factbase",
                    identifier: result.identifier
                });
            });
        }

        if (sourcesToSearch.includes("channel") && channelEmbeddingVectors.length > 0) {
            const channelSimilarities = computeSimilarities(queryEmbedding, channelEmbeddingVectors)
                .map((similarity, idx) => ({
                    similarity,
                    channelId: channels[idx].id
                }))
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, maxResults);

            channelSimilarities.forEach(({ similarity, channelId }) => {
                scoredEntries.push({
                    distance: similarity,
                    score: similarity,
                    source: "channel",
                    identifier: channelId
                });
            });
        }

        scoredEntries.sort((a, b) => b.score - a.score);
        const topEntries = scoredEntries.slice(0, maxResults);

        const searchLabel = (() => {
            switch (databaseChoice) {
                case "channel":
                    return "channels";
                case "dictionary":
                    return "the dictionary";
                case "repository":
                    return "the repository";
                case "factbase":
                    return "the fact base";
                default:
                    return isCalledByAdmin ? "all sources" : "the dictionary, repository, and channels";
            }
        })();

        const embedsAndComponents: { embed: EmbedBuilder, components: any[] }[] = [];

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

                    embedsAndComponents.push({ embed, components: [] });
                }

            } else if (entry.source === "repository") {
                const repoEntry = await guildHolder.getRepositoryManager().getEntryByPostCode(entry.identifier);
                if (!repoEntry) continue;

                const entryData = repoEntry.entry.getData();

                const name = entryData.code + ': ' + entryData.name;
                const authors = getAuthorsString(entryData.authors);
                const tags = entryData.tags.map(tag => tag.name).join(', ');
                const description = entryData.records.description as string || '';
                const image = await guildHolder.getPostThumbnailURL(entryData);

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

                embedsAndComponents.push({ embed, components: [] });
            } else if (entry.source === "channel") {
                const channel = channels.find(c => c.id === entry.identifier);
                if (!channel) continue;

                const embed = new EmbedBuilder()
                    .setTitle(truncateStringWithEllipsis(`Channel: ` + channel.name, 256))
                    .setDescription(truncateStringWithEllipsis(channel.description, 4000))
                    .setColor(0x0099ff);

                const url = `https://discord.com/channels/${guildHolder.getGuildId()}/${channel.id}`;
                embed.setURL(url);

                embedsAndComponents.push({ embed, components: [] });
            } else if (entry.source === "factbase") {
                const factEntry = await guildHolder.getFactManager().getFact(entry.identifier);
                if (!factEntry) continue;

                // // first parse citations [QAxx]
                // let text = factEntry.text;
                // factEntry.cited.forEach(citation => {
                //     const url = `https://discord.com/channels/748542142347083868/748549293433946133/${citation.message_ids[0]}`;
                //     text = text.replaceAll(`[QA${citation.number}]`, `[[QA${citation.number}]](${url})`);
                // });

                const citationsSorted: string[] = factEntry.citations.slice();

                // oldest to newest
                citationsSorted.sort((a, b) => {
                    const aIdNum = BigInt(a);
                    const bIdNum = BigInt(b);
                    return aIdNum < bIdNum ? -1 : aIdNum > bIdNum ? 1 : 0;
                });

                const citations = citationsSorted.map((id, i) => {
                    const url = `https://discord.com/channels/748542142347083868/748549293433946133/${id}`;
                    return `[[${i + 1}]](${url})`;
                }).join(' ');

                let text = `**Category:** ${factEntry.category || 'Uncategorized'}\n**Credibility:** ${factEntry.citations.length} citations ${citations}\n\n` +
                    factEntry.answer;

                const textSplit = splitIntoChunks(text, 4000);
                for (let i = 0; i < textSplit.length; i++) {
                    const embed = new EmbedBuilder()
                        .setTitle(truncateStringWithEllipsis(`Q: ` + factEntry.question, 256))
                        .setDescription(textSplit[i])
                        .setColor(0x8B4513);

                    if (textSplit.length > 1) {
                        embed.setFooter({ text: `Part ${i + 1} of ${textSplit.length}` });
                    }

                    const components = [];
                    if (i === textSplit.length - 1) {
                        const button = new EditFactButton().getBuilder(entry.identifier);
                        const row = new ActionRowBuilder().addComponents(button);
                        components.push(row);
                    }
                    embedsAndComponents.push({ embed, components });
                }
            }
        }

        if (embedsAndComponents.length === 0) {
            await interaction.editReply({
                content: `No relevant entries found in ${searchLabel}.`
            });
            return;
        }

        await interaction.editReply({
            content: truncateStringWithEllipsis(`You asked: \`${question}\`\nSearching ${searchLabel} (up to ${maxResults} results).\nHere are the most relevant entries I found:`, 2000),
            allowedMentions: { parse: [] }
        });

        // each embed gets its own message if more than 1
        for (let i = 0; i < embedsAndComponents.length; i++) {
            const { embed, components } = embedsAndComponents[i];
            await interaction.channel.send({
                embeds: [embed],
                components: components,
                flags: [MessageFlags.SuppressNotifications],
                allowedMentions: { parse: [] }
            });
        }
    }
}
