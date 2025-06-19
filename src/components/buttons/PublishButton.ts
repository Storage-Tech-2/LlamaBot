import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { canPublishSubmission, replyEphemeral } from "../../utils/Util";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs";

export class PublishButton implements Button {
    getID(): string {
        return "publish-button";
    }

    async getBuilder(is_published: boolean): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel(is_published ? 'Publish!' : 'Republish!')
            .setStyle(ButtonStyle.Success);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction): Promise<void> {
        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found');
            return;
        }

        if (
            !canPublishSubmission(interaction, submission)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return;
        }

        if (!submission.isPublishable()) {
            replyEphemeral(interaction, 'Submission is not publishable yet!');
            return;
        }

        await interaction.reply({
            content: `<@${interaction.user.id}> initiated publishing!`,
        });

        try {
            await submission.publish();
        } catch(e: any) {
            console.error(e);
            await interaction.followUp({
                content: `Failed to publish submission because of error: ${e.message}`,
            });
            return;
        }

        const url = submission.getConfigManager().getConfig(SubmissionConfigs.POST)?.threadURL;
              
        await interaction.followUp({
            content: `Submission published successfully! ${url}`
        });
    }

}