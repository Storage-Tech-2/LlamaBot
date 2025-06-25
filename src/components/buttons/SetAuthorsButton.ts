import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Interaction } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, reclassifyAuthors, replyEphemeral } from "../../utils/Util.js";
import { SetAuthorsMenu } from "../menus/SetAuthorsMenu.js";
import { AddAuthorButton } from "./AddAuthorButton.js";
import { Submission } from "../../submissions/Submission.js";
import { AuthorType } from "../../submissions/Author.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { ConfirmAuthorsButton } from "./ConfirmAuthorsButton.js";

export class SetAuthorsButton implements Button {
    getID(): string {
        return "set-authors-button";
    }

    getBuilder(isSet: boolean): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel(isSet ? 'Change Authors' : 'Let\'s Start!')
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

        SetAuthorsMenu.sendAuthorsMenuAndButton(submission, interaction);
    }

}