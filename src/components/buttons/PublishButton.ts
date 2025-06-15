import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { AddAuthorModal } from "../modals/AddAuthorModal";

export class PublishButton implements Button {
    getID(): string {
        return "publish-button";
    }

    async getBuilder(): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Publish!')
            .setStyle(ButtonStyle.Success);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, ...args: string[]): Promise<void> {
        if (
            !isOwner(interaction)
            // !hasPerms(interaction)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return;
        }

        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found');
            return;
        }

        if (!submission.isPublishable()) {
            replyEphemeral(interaction, 'Submission is not publishable yet!');
            return;
        }

        interaction.reply({
            content: 'Publishing submission...',
        });

        //submission.publish();
    }

}