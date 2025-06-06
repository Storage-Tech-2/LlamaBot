import { ButtonBuilder, ButtonInteraction } from "discord.js";
import { GuildHolder } from "../GuildHolder";

/**
 * Button interface for defining discord.js button components.
 */
export interface Button {

    /**
     * Returns the custom ID for the button.
     */
    getID(): string;

    /**
     * Returns the button builder
     */
    getBuilder(...args: any[]): ButtonBuilder;

    /**
     * Executes the button action.
     */
    execute(guildHolder: GuildHolder, interaction: ButtonInteraction, ...args: string[]): Promise<void>;
}