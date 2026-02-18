import { Message } from "discord.js";
import { SysAdminCommand } from "../SysAdminCommand.js";
import { SysAdminCommandContext } from "../SysAdminCommandContext.js";
import { getConnectedGuild, getErrorMessage, isValidSnowflake, SYSADMIN_ROLE_NAME } from "./SysAdminGuildUtils.js";

export class DeopSysAdminCommand implements SysAdminCommand {
    public aliases = ["deop"];

    public async execute(context: SysAdminCommandContext, message: Message, args: string[]): Promise<void> {
        const guildId = args[0];
        if (!guildId || !isValidSnowflake(guildId)) {
            await message.reply("Usage: `/deop <guild_id>`");
            return;
        }

        const guild = getConnectedGuild(context.client, guildId);
        if (!guild) {
            await message.reply(`Guild ${guildId} is not connected to the bot.`);
            return;
        }

        const role = guild.roles.cache.find((currentRole) => currentRole.name === SYSADMIN_ROLE_NAME) ?? null;
        if (!role) {
            await message.reply(`Role "${SYSADMIN_ROLE_NAME}" does not exist in ${guild.name} (${guild.id}).`);
            return;
        }

        try {
            const sysAdminMember = await guild.members.fetch(message.author.id).catch(() => null);
            let removedFromMember = false;
            if (sysAdminMember?.roles.cache.has(role.id)) {
                await sysAdminMember.roles.remove(role);
                removedFromMember = true;
            }

            await role.delete("SysAdmin /deop command");
            await message.reply(
                `Deop complete for ${guild.name} (${guild.id}). Deleted role "${SYSADMIN_ROLE_NAME}".` +
                `${removedFromMember ? " Removed role from SysAdmin before deletion." : ""}`,
            );
        } catch (error) {
            const errorMessage = getErrorMessage(error);
            console.error(`Error running /deop for guild ${guild.id}:`, error);
            await message.reply(`Failed to deop ${guild.name} (${guild.id}): ${errorMessage}`);
        }
    }
}
