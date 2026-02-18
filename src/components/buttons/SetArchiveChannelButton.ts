import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { SetArchiveCategoryMenu } from "../menus/SetArchiveCategoryMenu.js";

export class SetArchiveChannelButton implements Button {
    getID(): string {
        return "set-archive-channel-button";
    }

    getBuilder(isSet: boolean): ButtonBuilder {
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

        await SetArchiveCategoryMenu.sendArchiveCategorySelector(submission, interaction);
    }

}