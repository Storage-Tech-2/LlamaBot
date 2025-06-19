import { RoleSelectMenuBuilder, RoleSelectMenuInteraction } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Menu } from "../../interface/Menu";
import { isAdmin, replyEphemeral } from "../../utils/Util";
import { GuildConfigs } from "../../config/GuildConfigs";

export class SetEditorRolesMenu implements Menu {
    getID(): string {
        return "set-editor-roles-menu";
    }

    async getBuilder(guildHolder: GuildHolder): Promise<RoleSelectMenuBuilder> {
        const guild = guildHolder.getGuild();
        const roles = (await guild.roles.fetch());

        const currentRoles = guildHolder.getConfigManager().getConfig(GuildConfigs.EDITOR_ROLE_IDS) || [];
        return new RoleSelectMenuBuilder()
            .setCustomId(this.getID())
            .setMinValues(0)
            .setMaxValues(Math.min(25, roles.size))
            .setPlaceholder('Select editor roles')
            .setDefaultRoles(currentRoles)
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
        
        guildHolder.getConfigManager().setConfig(GuildConfigs.EDITOR_ROLE_IDS, roles.map(role => role.id));
        interaction.reply({
            content: `<@${interaction.user.id}> Modified the editor roles to: ${roles.map(role => role.name).join(', ')}`,
        });
    }

}