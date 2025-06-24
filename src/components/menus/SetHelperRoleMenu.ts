import { RoleSelectMenuBuilder, RoleSelectMenuInteraction } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { isAdmin, replyEphemeral } from "../../utils/Util.js";
import { GuildConfigs } from "../../config/GuildConfigs.js";

export class SetHelperRoleMenu implements Menu {
    getID(): string {
        return "set-helper-role-menu";
    }

    async getBuilder(guildHolder: GuildHolder): Promise<RoleSelectMenuBuilder> {
        const currentRole = guildHolder.getConfigManager().getConfig(GuildConfigs.HELPER_ROLE_ID);
        return new RoleSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(0)
            .setMaxValues(1)
            .setPlaceholder('Select helper role')
            .setDefaultRoles(currentRole ? [currentRole] : [])
    }
    async execute(guildHolder: GuildHolder, interaction: RoleSelectMenuInteraction): Promise<void> {
        if (
            !isAdmin(interaction)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return
        }

        const selectedRoles = interaction.values;
        const guild = guildHolder.getGuild();
        const roles = (await guild.roles.fetch()).filter(role => selectedRoles.includes(role.id));
        
        guildHolder.getConfigManager().setConfig(GuildConfigs.HELPER_ROLE_ID, roles.first()?.id || '');
        interaction.reply({
            content: `<@${interaction.user.id}> Modified the helper roles to: ${roles.first()?.name || 'None'}`,
        });
    }

}