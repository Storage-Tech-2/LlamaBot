import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";

/**
 * Command interface for defining discord.js commands.
 */
export interface Command {
    /**
     * Returns the custom ID for the command.
     */
    getID(): string;

    /**
     * Returns the command builder
     */
    getBuilder(guildHolder: GuildHolder): SlashCommandBuilder;

    /**
     * Executes the command action.
     */
    execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void>;
}