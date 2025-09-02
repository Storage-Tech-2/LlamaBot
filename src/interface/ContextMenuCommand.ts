import { ContextMenuCommandBuilder, ContextMenuCommandInteraction } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";

/**
 * Interface for defining discord.js context menu commands.
 */
export interface ContextMenuCommand {
    /**
     * Returns the custom ID for the command.
     */
    getID(): string;

    /**
     * Returns the command builder
     */
    getBuilder(guildHolder: GuildHolder): ContextMenuCommandBuilder;

    /**
     * Executes the command action.
     */
    execute(guildHolder: GuildHolder, interaction: ContextMenuCommandInteraction): Promise<void>;
}