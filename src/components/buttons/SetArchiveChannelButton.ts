import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { canEditSubmission, replyEphemeral } from "../../utils/Util";
import { SetArchiveCategoryMenu } from "../menus/SetArchiveCategoryMenu";

export class SetArchiveChannelButton implements Button {
    getID(): string {
        return "set-archive-channel-button";
    }

    async getBuilder(isSet: boolean): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel(isSet ? 'Change Channel' : 'Set Channel')
            .setStyle(isSet ? ButtonStyle.Secondary : ButtonStyle.Primary)
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
        await replyEphemeral(interaction, `<@${interaction.user.id}> Please select an archive category`, {
            components: [row]
        })
    }

}