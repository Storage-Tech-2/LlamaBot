import { Message } from "discord.js";
import { splitIntoChunks } from "../../utils/Util.js";
import { SysAdminCommand } from "../SysAdminCommand.js";
import { SysAdminCommandContext } from "../SysAdminCommandContext.js";

export class ListSysAdminCommand implements SysAdminCommand {
    public aliases = ["list"];

    public async execute(context: SysAdminCommandContext, message: Message, _args: string[]): Promise<void> {
        const connectedGuilds = Array.from(context.client.guilds.cache.values())
            .sort((a, b) => a.name.localeCompare(b.name));

        if (connectedGuilds.length === 0) {
            await message.reply("Bot is not currently connected to any servers.");
            return;
        }

        const lines = connectedGuilds.map((guild) => `- ${guild.name} (${guild.id})`);

        const chunks = splitIntoChunks(lines.join("\n"), 1800);
        await message.reply(`Connected servers (${connectedGuilds.length}):\n${chunks[0]}`);
        for (let i = 1; i < chunks.length; i++) {
            await message.reply(chunks[i]);
        }
    }
}
