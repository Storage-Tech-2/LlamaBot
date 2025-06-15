import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { SetArchiveCategoryMenu } from "../menus/SetArchiveCategoryMenu";
import { SetAuthorsMenu } from "../menus/SetAuthorsMenu";
import { AddAuthorModal } from "../modals/AddAuthorModal";

export class AddAuthorButton implements Button {
    getID(): string {
        return "add-author-button";
    }

    async getBuilder(): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Add Author Not In List')
            .setStyle(ButtonStyle.Primary)
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, ...args: string[]): Promise<void> {
        if (
            !isOwner(interaction) &&
            !hasPerms(interaction)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
        }

        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found');
            return;
        }

        const modal = await new AddAuthorModal().getBuilder()
        await interaction.showModal(modal);
    }

}