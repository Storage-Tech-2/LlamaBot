import { Message } from "discord.js";
import { SysAdminCommandContext } from "./SysAdminCommandContext.js";

export interface SysAdminCommand {
    aliases: string[];
    execute(context: SysAdminCommandContext, message: Message, args: string[]): Promise<void>;
}
