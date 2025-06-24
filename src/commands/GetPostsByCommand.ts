import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { getAuthorFromIdentifier, replyEphemeral } from "../utils/Util.js";
import { Author, AuthorType } from "../submissions/Author.js";

export class GetPostsByCommand implements Command {
    getID(): string {
        return "getpostsby";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Get posts by an author or endorser')
            .setContexts(InteractionContextType.Guild);
        data.addSubcommand(subcommand =>
            subcommand
                .setName('author')
                .setDescription('Get posts by an author')
                .addStringOption(option =>
                    option.setName('author')
                        .setDescription('The author\'s Discord ID or username')
                        .setRequired(true)
                )
        )
           data.addSubcommand(subcommand =>
            subcommand
                .setName('endorser')
                .setDescription('Get posts by an author')
                .addStringOption(option =>
                    option.setName('endorser')
                        .setDescription('The endorser\'s Discord ID or username')
                        .setRequired(true)
                )
        )
        
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (
            !interaction.inGuild() ||
            !interaction.channel
        ) {
            await replyEphemeral(interaction, 'This command can only be used in a forum channel.')
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        
        if (subcommand === 'author' || subcommand === 'endorser') {
            const identifier = interaction.options.getString(subcommand, true);
            // check if identifier is a valid Discord ID
            const author = await getAuthorFromIdentifier(guildHolder, identifier);
            if (!author) {
                await replyEphemeral(interaction, `Invalid identifier: ${identifier}. Please provide a valid Discord ID or username.`);
                return;
            }

            const entries = await guildHolder.getRepositoryManager().getEntriesByAuthor(author, subcommand === 'endorser');
            if (entries.length === 0) {
                await replyEphemeral(interaction, `No posts found for ${subcommand} with identifier: ${identifier}`);
                return;
            }

            const postList = entries.map(entry => {
                return `\n- <t:${Math.floor(entry.timestamp/1000)}:D> ${entry.post?.threadURL}`;
            });

            // split into chunks of 2000 characters
            const chunks = [];
            let currentChunk = `Found ${entries.length} posts where ${author.displayName || author.username} ${subcommand === 'author' ? 'is an author' : 'is an endorser'}:\n`;
            for (const post of postList) {
                if ((currentChunk + post).length > 2000) {
                    chunks.push(currentChunk);
                    currentChunk = '';
                }
                currentChunk += post;
            }

            if (currentChunk) {
                chunks.push(currentChunk);
            }

            // send chunks
            for (const chunk of chunks) {
                if (interaction.replied) {
                    await interaction.channel.send({ content: chunk });
                } else {
                    await interaction.reply({ content: chunk });
                }
            }
        } else {
            await replyEphemeral(interaction, 'Invalid subcommand. Use `/getpostsby author` or `/getpostsby endorser`.');
            return;
        }

    }

}