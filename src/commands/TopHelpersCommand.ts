import { ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { replyEphemeral, splitIntoChunks } from "../utils/Util.js";

export class TopHelpersCommand implements Command {
    getID(): string {
        return "tophelpers";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder();
        data.setName(this.getID())
            .setDescription('Show the most thanked members in the last 30 days')
            .setContexts(InteractionContextType.Guild);
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild()) {
            await replyEphemeral(interaction, 'This command can only be used in a guild channel.');
            return;
        }

        const userManager = guildHolder.getUserManager();
        const userIds = await userManager.getAllUserIDs();
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

        const leaderboard = [];
        for (const userId of userIds) {
            const userData = await userManager.getUserData(userId);
            if (!userData) {
                continue;
            }
            const recentThanks = (userData.thankedBuffer || []).filter(thank => thank.timestamp >= thirtyDaysAgo);
            if (recentThanks.length === 0) {
                continue;
            }
            leaderboard.push({
                id: userId,
                username: userData.username,
                thanks: recentThanks.length,
            });
        }

        if (leaderboard.length === 0) {
            await interaction.reply({
                content: 'No thanks have been recorded in the last 30 days.',
            });
            return;
        }

        leaderboard.sort((a, b) => b.thanks - a.thanks);
        const topEntries = leaderboard.slice(0, 10);

        const fetchedMembers = await guildHolder.getGuild().members.fetch({ user: topEntries.map(entry => entry.id) }).catch(() => null);
        const lines = topEntries.map((entry, index) => {
            const member = fetchedMembers?.get(entry.id);
            const displayName = member?.displayName || entry.username || entry.id;
            const thanksLabel = entry.thanks === 1 ? 'thank' : 'thanks';
            let ranktext = '';
            switch (index) {
                case 0:
                    ranktext = '🥇';
                    break;
                case 1:
                    ranktext = '🥈';
                    break;
                case 2:
                    ranktext = '🥉';
                    break;
                default:
                    ranktext = `**#${index + 1}**`;
                    break;
            }
            return `${ranktext} <@${entry.id}> (${displayName}) — ${entry.thanks} ${thanksLabel}`;
        });

        const content = [
            ...lines
        ].join('\n');


        const split = splitIntoChunks(content, 4000);
        
        for (let i = 0; i < split.length; i++) {
            const embed = new EmbedBuilder()
                .setTitle('Top 10 helpers in the last 30 days' + (split.length > 1 ? ` (Part ${i + 1}/${split.length})` : ''))
                .setDescription(split[i])
                .setColor(0x00AE86);
            if (i === 0) {
                await interaction.reply({ 
                    embeds: [embed],
                    flags: [MessageFlags.SuppressNotifications],
                    allowedMentions: { parse: [] }
                });
            } else {
                await interaction.followUp({ 
                    embeds: [embed],
                    flags: [MessageFlags.SuppressNotifications],
                    allowedMentions: { parse: [] }
                });
            }
        }
    }
}
