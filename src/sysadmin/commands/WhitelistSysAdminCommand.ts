import { Message, Snowflake } from "discord.js";
import { splitIntoChunks } from "../../utils/Util.js";
import { SysAdminCommand } from "../SysAdminCommand.js";
import { SysAdminCommandContext } from "../SysAdminCommandContext.js";

export class WhitelistSysAdminCommand implements SysAdminCommand {
    public aliases = ["whitelist", "wl"];

    public async execute(context: SysAdminCommandContext, message: Message, args: string[]): Promise<void> {
        const subcommand = (args.shift() || "list").toLowerCase();

        if (subcommand === "help") {
            await message.reply(
                "Whitelist commands:\n" +
                "- `/whitelist list` (or `/whitelist status`)\n" +
                "- `/whitelist add <guild_id>`\n" +
                "- `/whitelist remove <guild_id>`\n" +
                "- `/whitelist clear`\n" +
                "\n" +
                "When the whitelist has at least one guild ID, only those guilds are allowed.",
            );
            return;
        }

        if (subcommand === "list" || subcommand === "status") {
            const guildIds = context.guildWhitelistManager.getGuildIds();
            if (guildIds.length === 0) {
                await message.reply("Whitelist is empty. Enforcement is OFF, so all guilds are currently allowed.\nUse `/whitelist add <guild_id>` to enable enforcement.");
                return;
            }

            const lines = guildIds.map((id) => {
                const isJoined = context.client.guilds.cache.has(id);
                return `- ${this.getGuildLabel(context, id)}${isJoined ? " [joined]" : ""}`;
            });
            const chunks = splitIntoChunks(lines.join("\n"), 1800);
            await message.reply(`Whitelist is ON (${guildIds.length} guild${guildIds.length === 1 ? "" : "s"}):\n${chunks[0]}`);
            for (let i = 1; i < chunks.length; i++) {
                await message.reply(chunks[i]);
            }
            return;
        }

        if (subcommand === "add") {
            const guildId = args[0];
            if (!guildId || !this.isValidSnowflake(guildId)) {
                await message.reply("Usage: `/whitelist add <guild_id>`");
                return;
            }

            const added = await context.guildWhitelistManager.addGuild(guildId);
            const nonWhitelistedGuilds = await this.enforceWhitelistForAllGuilds(context);
            await message.reply(
                `${added ? `Added ${this.getGuildLabel(context, guildId)} to the whitelist.` : `${guildId} is already in the whitelist.`}` +
                this.getWhitelistMismatchSummary(nonWhitelistedGuilds),
            );
            return;
        }

        if (subcommand === "remove") {
            const guildId = args[0];
            if (!guildId || !this.isValidSnowflake(guildId)) {
                await message.reply("Usage: `/whitelist remove <guild_id>`");
                return;
            }

            const removed = await context.guildWhitelistManager.removeGuild(guildId);
            const nonWhitelistedGuilds = await this.enforceWhitelistForAllGuilds(context);
            const disabledNotice = !context.guildWhitelistManager.isEnforced()
                ? "\nWhitelist is now empty. Enforcement is OFF, so all guilds are allowed."
                : "";
            await message.reply(
                `${removed ? `Removed ${guildId} from the whitelist.` : `${guildId} was not in the whitelist.`}` +
                disabledNotice +
                this.getWhitelistMismatchSummary(nonWhitelistedGuilds),
            );
            return;
        }

        if (subcommand === "clear") {
            const cleared = await context.guildWhitelistManager.clear();
            await message.reply(
                cleared
                    ? "Whitelist cleared. Enforcement is OFF, so all guilds are allowed."
                    : "Whitelist is already empty. Enforcement is OFF, so all guilds are allowed.",
            );
            return;
        }

        await message.reply("Unknown whitelist command. Use `/whitelist help`.");
    }

    private isValidSnowflake(input: string): input is Snowflake {
        return /^\d{17,20}$/.test(input);
    }

    private getGuildLabel(context: SysAdminCommandContext, guildId: Snowflake): string {
        const guild = context.client.guilds.cache.get(guildId);
        return guild ? `${guild.name} (${guild.id})` : guildId;
    }

    private getWhitelistMismatchSummary(nonWhitelistedGuilds: string[]): string {
        if (nonWhitelistedGuilds.length === 0) {
            return "";
        }

        const shown = nonWhitelistedGuilds.slice(0, 5);
        const lines = shown.map((name) => `- ${name}`);
        const hiddenCount = nonWhitelistedGuilds.length - shown.length;
        const hiddenText = hiddenCount > 0 ? `\n...and ${hiddenCount} more.` : "";
        return `\nNon-whitelisted guild(s) still joined (leave disabled):\n${lines.join("\n")}${hiddenText}`;
    }

    private async enforceWhitelistForAllGuilds(context: SysAdminCommandContext): Promise<string[]> {
        if (!context.guildWhitelistManager.isEnforced()) {
            return [];
        }

        const nonWhitelistedGuilds: string[] = [];
        for (const guild of context.client.guilds.cache.values()) {
            if (context.guildWhitelistManager.isGuildAllowed(guild.id)) {
                continue;
            }

            context.guilds.delete(guild.id);
            context.dayTaskTimestamps.delete(guild.id);
            nonWhitelistedGuilds.push(`${guild.name} (${guild.id})`);
            console.log(`Guild ${guild.name} (${guild.id}) is not whitelisted. No leave action taken (leave disabled).`);
        }

        return nonWhitelistedGuilds;
    }
}
