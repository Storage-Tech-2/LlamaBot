import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { getAuthorFromIdentifier, replyEphemeral } from "../utils/Util.js";
import { GuildConfigs } from "../config/GuildConfigs.js";

export class ToggleHelper implements Command {
    getID(): string {
        return "togglehelper";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Toggle helper role if you have it')
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

        let userData = await guildHolder.getUserManager().getUserData(interaction.user.id);
        if (!userData) {
            //await replyEphemeral(interaction, `You need at least ${guildHolder.getConfigManager().getConfig(GuildConfigs.HELPER_ROLE_THRESHOLD)} thank-you points to toggle the helper role.`);
            userData = {
                id: interaction.user.id,
                username: interaction.user.username,
                thankedCountTotal: 0,
                thankedBuffer: [],
                disableRole: false // Initialize disableRole to false
            };
        }

        userData.disableRole = !userData.disableRole;
        await guildHolder.getUserManager().saveUserData(userData);
        await guildHolder.checkHelper(userData);

        const status = userData.disableRole ? 'disabled' : 'enabled';
        await interaction.reply({
            content: `Helper role has been ${status}. Please toggle it again if you change your mind.`,
            ephemeral: true
        });
    }

}