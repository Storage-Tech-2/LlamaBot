import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Interaction } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, reclassifyAuthors, replyEphemeral } from "../../utils/Util.js";
import { SetAuthorsMenu } from "../menus/SetAuthorsMenu.js";
import { AddAuthorButton } from "./AddAuthorButton.js";
import { Submission } from "../../submissions/Submission.js";
import { AuthorType } from "../../submissions/Author.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";

export class SetAuthorsButton implements Button {
    getID(): string {
        return "set-authors-button";
    }

    async getBuilder(isSet: boolean): Promise<ButtonBuilder> {
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

        SetAuthorsButton.sendAuthorsMenuAndButton(guildHolder, submission, interaction);
    }

    public static async sendAuthorsMenuAndButton(guildHolder: GuildHolder, submission: Submission, interaction: Interaction) {
        const components = [];
        const row = new ActionRowBuilder()
            .addComponents(await new SetAuthorsMenu().getBuilder(guildHolder, submission, false));
        components.push(row);

        // Update existing authors
        const updatedAuthors =  await reclassifyAuthors(guildHolder, submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || []);
        if (updatedAuthors.length > 0) {
            submission.getConfigManager().setConfig(SubmissionConfigs.AUTHORS, updatedAuthors);
        }

        // get authors
        const currentAuthors = (submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || []).filter(author => {
            return author.type === AuthorType.Unknown || author.type === AuthorType.DiscordDeleted;
        });
        if (currentAuthors.length > 0) {
            const row1 = new ActionRowBuilder()
                .addComponents(await new SetAuthorsMenu().getBuilder(guildHolder, submission, true));
            components.push(row1);
        }
        const row2 = new ActionRowBuilder()
            .addComponents(await new AddAuthorButton().getBuilder());
        components.push(row2);
        await replyEphemeral(interaction, `Please select author(s) for the submission`, {
            components
        });
    }
}