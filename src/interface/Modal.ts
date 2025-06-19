import { ModalBuilder, ModalSubmitInteraction } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";

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
    getBuilder(...args: any[]): Promise<ModalBuilder>;

    /**
     * Executes the modal action.
     */
    execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction, ...args: any[]): Promise<void>;
}