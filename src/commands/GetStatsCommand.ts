import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { replyEphemeral } from "../utils/Util.js";

export class GetStatsCommand implements Command {
    getID(): string {
        return "getstats";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Get statistics about the archive')
            .setContexts(InteractionContextType.Guild)
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (
            !interaction.inGuild()
        ) {
            await replyEphemeral(interaction, 'This command can only be used in a guild channel.')
            return;
        }

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