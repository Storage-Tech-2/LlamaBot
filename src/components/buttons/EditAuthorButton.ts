import { ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, getAuthorKey, getAuthorName, replyEphemeral, truncateStringWithEllipsis } from "../../utils/Util.js";
import { Author } from "../../submissions/Author.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { AuthorModal } from "../modals/AuthorModal.js";

export class EditAuthorButton implements Button {
    getID(): string {
        return "edit-author-btn";
    }

    getBuilder(author: Author): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID() + '|' + getAuthorKey(author).substring(0, 50)) // In case something goes wrong with the author key generation, we don't want it to exceed Discord's limits
            .setLabel(truncateStringWithEllipsis(`Edit: ${getAuthorName(author)}` , 80))
            .setStyle( ButtonStyle.Secondary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, key: string): Promise<void> {
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

        const authors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || [];
        const authorToEdit = authors.findIndex(a => getAuthorKey(a).substring(0, 50) === key);
        if (authorToEdit === -1) {
            replyEphemeral(interaction, 'Author not found');
            return;
        }

        const modal = new AuthorModal().getBuilder(authorToEdit + 1, authors[authorToEdit]);
        await interaction.showModal(modal);
    }
}