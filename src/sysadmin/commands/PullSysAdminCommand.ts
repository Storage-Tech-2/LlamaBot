import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { Message } from "discord.js";
import { SysAdminCommand } from "../SysAdminCommand.js";
import { SysAdminCommandContext } from "../SysAdminCommandContext.js";

export class PullSysAdminCommand implements SysAdminCommand {
    public aliases = ["pull"];

    public async execute(_context: SysAdminCommandContext, message: Message, _args: string[]): Promise<void> {
        await message.reply("Running git pull...");

        try {
            await fs.access(path.join(process.cwd(), ".git"));
        } catch (error) {
            console.error("Not a git repository:", error);
            await message.reply("Not a git repository. Cannot refresh.");
            return;
        }

        try {
            await this.runGitPull();
            await message.reply("Bot refreshed successfully!");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error pulling changes: ${errorMessage}`);
            await message.reply(`Error pulling changes: ${errorMessage}`);
        }
    }

    private runGitPull(): Promise<void> {
        return new Promise((resolve, reject) => {
            exec("git pull", { cwd: process.cwd() }, (error, stdout, _stderr) => {
                if (error) {
                    reject(error);
                    return;
                }

                console.log(`Git pull output: ${stdout}`);
                resolve();
            });
        });
    }
}
