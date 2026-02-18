import { AnySelectMenuInteraction, BaseSelectMenuBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";

/**
 * Button interface for defining discord.js select menu components.
 */
export interface Menu {

    /**
     * Returns the custom ID for the menu.
     */
    getID(): string;

    /**
     * Returns the menu builder
     */
    getBuilder(...args: any[]): Promise<BaseSelectMenuBuilder<any>> | BaseSelectMenuBuilder<any>;

    /**
     * Executes the menu action.
     */
    execute(guildHolder: GuildHolder, interaction: AnySelectMenuInteraction,...args: string[]): Promise<void>;
}