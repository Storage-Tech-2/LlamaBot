import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { canEditSubmission, replyEphemeral } from "../../utils/Util";
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

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction): Promise<void> {
        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found');
            return;
        }

        if (
            !canEditSubmission(interaction, submission)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
        }


        const modal = await new AddAuthorModal().getBuilder()
        await interaction.showModal(modal);
    }

}