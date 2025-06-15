import { ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { Revision, RevisionType, TempRevisionData } from "../../submissions/Revision";
import { AuthorType } from "../../submissions/Author";
import { RevisionEmbed } from "../../embed/RevisionEmbed";

export class MakeRevisionCurrentButton implements Button {
    getID(): string {
        return "make-revision-current";
    }

    async getBuilder(): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Make Current')
            .setStyle(ButtonStyle.Primary)
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, isYes: string, revisionId: Snowflake, ...args: string[]): Promise<void> {
        if (!isOwner(interaction) && !hasPerms(interaction)) {
            replyEphemeral(interaction, "You do not have permission to use this!");
            return;
        }

        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, "Submission not found");
            return;
        }

        const revision = await submission.getRevisionsManager().getRevisionById(interaction.message.id)
        if (!revision) {
            replyEphemeral(interaction, 'Revision not found')
            return
        }
        await submission.getRevisionsManager().setCurrentRevision(revision.id);
        const message = await (await submission.getSubmissionChannel()).messages.fetch(revision.id);
        await interaction.reply({
            content: `<@${interaction.user.id}> changed current revision to ${message.url}`
        });
        submission.updateStatusMessage();
    }
}