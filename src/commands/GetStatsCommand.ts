import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { getAuthorFromIdentifier, getAuthorName, replyEphemeral } from "../utils/Util.js";

export class GetStatsCommand implements Command {
    getID(): string {
        return "getstats";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Get statistics about the archive or user')
            .setContexts(InteractionContextType.Guild)
            .addStringOption(option =>
                option.setName('user')
                    .setDescription('Get statistics for a specific user')
                    .setRequired(false)
            );
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (
            !interaction.inGuild()
        ) {
            await replyEphemeral(interaction, 'This command can only be used in a guild channel.')
            return;
        }

        const identifier = interaction.options.getString('user', false);
        if (identifier) {
            const author = await getAuthorFromIdentifier(guildHolder, identifier);
            if (!author) {
                await replyEphemeral(interaction, `Invalid identifier: ${identifier}. Please provide a valid Discord ID or username.`);
                return;
            }
            const repositoryManager = guildHolder.getRepositoryManager();
            const stats = await repositoryManager.getUserArchiveStats(author);
            if (!stats) {
                await replyEphemeral(interaction, `Failed to retrieve statistics for user ${author.username}.`);
                return;
            }
            const response = [
                `**Archive Statistics for ${getAuthorName(author)}**`,
                `- **Total Submissions:** ${stats.numSubmissions}`,
                `- **Total Archived Posts:** ${stats.numPosts}`,
                `- **Total Endorsed Posts:** ${stats.numEndorsed}`
            ].join('\n');
            await interaction.reply({
                content: response
            });
        } else {
            const repositoryManager = guildHolder.getRepositoryManager();
            const stats = await repositoryManager.getArchiveStats();
            if (!stats) {
                await replyEphemeral(interaction, 'Failed to retrieve archive statistics.');
                return;
            }
            const response = [
                `**Archive Statistics for ${guildHolder.getGuild().name}**`,
                `- **Total Submissions:** ${stats.numSubmissions}`,
                `- **Total Archived Posts:** ${stats.numPosts}`
            ].join('\n');
            await interaction.reply({
                content: response
            });
        }
    }

}