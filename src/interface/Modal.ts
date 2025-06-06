import { ModalBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder";

/**
 * Button interface for defining discord.js select modal components.
 */
export interface Modal {

    /**
     * Returns the custom ID for the modal.
     */
    getID(): string;

    /**
     * Returns the modal builder
     */
    getBuilder(...args: any[]): ModalBuilder;

    /**
     * Executes the modal action.
     */
    execute(guildHolder: GuildHolder, ...args: any[]): Promise<void>;
}