import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType, PermissionFlagsBits, Role, MessageFlags } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { replyEphemeral } from "../utils/Util.js";
import { SysAdmin } from "../Bot.js";

export class KickRoleCommand implements Command {
    getID(): string {
        return "kickrole";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder();
            
        data.setName(this.getID())
            .setDescription('Kick every member with the given role')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .setContexts(InteractionContextType.Guild)
            .addRoleOption(option =>
                option
                    .setName('role')
                    .setDescription('Role to kick from the guild')
                    .setRequired(true)
            );

        return data;
    }

    async execute(_guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild() || !interaction.guild) {
            await replyEphemeral(interaction, 'This command can only be used in a guild.');
            return;
        }

        if (interaction.user.id !== SysAdmin) {
            await replyEphemeral(interaction, 'You are not authorized to use this command.');
            return;
        }

        const role = interaction.options.getRole('role') as Role | null;
        if (!role || role.guild.id !== interaction.guild.id) {
            await replyEphemeral(interaction, 'Invalid role.');
            return;
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const members = await interaction.guild.members.fetch();
        const membersWithRole = members.filter(member => member.roles.cache.has(role.id));

        let kicked = 0;
        const failed: string[] = [];

        for (const member of membersWithRole.values()) {
            if (!member.kickable) {
                failed.push(`${member.user.tag} (${member.id}) - insufficient permissions`);
                continue;
            }

            try {
                await member.kick(`Removed via /kickrole by ${interaction.user.tag}`);
                kicked++;
            } catch (error: any) {
                failed.push(`${member.user.tag} (${member.id}) - ${error?.message || 'unknown error'}`);
            }
        }

        const attempted = membersWithRole.size;
        const failedSummary = failed.length > 0 ? `\nFailed (${failed.length}):\n${failed.slice(0, 10).join('\n')}${failed.length > 10 ? '\n...' : ''}` : '';
        await interaction.editReply(`Attempted to kick ${attempted} member${attempted === 1 ? '' : 's'} with role ${role.name}.\nKicked: ${kicked}${failedSummary}`);
    }
}
