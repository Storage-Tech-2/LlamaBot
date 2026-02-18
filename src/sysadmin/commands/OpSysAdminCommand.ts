import { Message, PermissionFlagsBits } from "discord.js";
import { SysAdminCommand } from "../SysAdminCommand.js";
import { SysAdminCommandContext } from "../SysAdminCommandContext.js";
import { getConnectedGuild, getErrorMessage, isValidSnowflake, SYSADMIN_ROLE_NAME } from "./SysAdminGuildUtils.js";

export class OpSysAdminCommand implements SysAdminCommand {
    public aliases = ["op"];

    public async execute(context: SysAdminCommandContext, message: Message, args: string[]): Promise<void> {
        const guildId = args[0];
        if (!guildId || !isValidSnowflake(guildId)) {
            await message.reply("Usage: `/op <guild_id>`");
            return;
        }

        const guild = getConnectedGuild(context.client, guildId);
        if (!guild) {
            await message.reply(`Guild ${guildId} is not connected to the bot.`);
            return;
        }

        const sysAdminMember = await guild.members.fetch(message.author.id).catch(() => null);
        if (!sysAdminMember) {
            await message.reply(`SysAdmin user ${message.author.id} is not a member of ${guild.name} (${guild.id}).`);
            return;
        }

        try {
            let role = guild.roles.cache.find((currentRole) => currentRole.name === SYSADMIN_ROLE_NAME) ?? null;
            let createdRole = false;
            let updatedPermissions = false;
            let addedToMember = false;

            if (!role) {
                role = await guild.roles.create({
                    name: SYSADMIN_ROLE_NAME,
                    permissions: [PermissionFlagsBits.Administrator],
                });
                createdRole = true;
            } else if (!role.permissions.has(PermissionFlagsBits.Administrator)) {
                role = await role.setPermissions([PermissionFlagsBits.Administrator]);
                updatedPermissions = true;
            }

            if (!sysAdminMember.roles.cache.has(role.id)) {
                await sysAdminMember.roles.add(role);
                addedToMember = true;
            }

            await message.reply(
                `Op complete for ${guild.name} (${guild.id}).` +
                `${createdRole ? ` Created role "${SYSADMIN_ROLE_NAME}".` : ""}` +
                `${updatedPermissions ? ` Updated role "${SYSADMIN_ROLE_NAME}" to Administrator.` : ""}` +
                `${addedToMember ? ` Added role to <@${message.author.id}>.` : " SysAdmin already had the role."}`,
            );
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`Error running /op for guild ${guild.id}:`, error);
            await message.reply(`Failed to op ${guild.name} (${guild.id}): ${errorMessage}`);
        }
    }
}
