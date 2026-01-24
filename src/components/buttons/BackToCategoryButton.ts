import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { SetArchiveCategoryMenu } from "../menus/SetArchiveCategoryMenu.js";

export class BackToCategoryButton implements Button {
    getID(): string {
        return "back-to-category-button";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Change Category')
            .setStyle(ButtonStyle.Secondary)
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
            return;
        }

        const row = new ActionRowBuilder()
            .addComponents(await new SetArchiveCategoryMenu().getBuilder(guildHolder))
        await interaction.update({
            content: `Please select an archive category`,
            components: [row as any]
        })
    }

}