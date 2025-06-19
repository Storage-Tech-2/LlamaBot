import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Interaction } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { canEditSubmission, replyEphemeral } from "../../utils/Util";
import { SetAuthorsMenu } from "../menus/SetAuthorsMenu";
import { AddAuthorButton } from "./AddAuthorButton";
import { Submission } from "../../submissions/Submission";
import { AuthorType } from "../../submissions/Author";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs";

export class SetAuthorsButton implements Button {
    getID(): string {
        return "set-authors-button";
    }

    async getBuilder(isSet: boolean): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel(isSet ? 'Change Authors' : 'Set Authors')
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

        // get authors
        const currentAuthors = (submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || []).filter(author => {
            return author.type === AuthorType.Unknown;
        });
        if (currentAuthors.length > 0) {
            const row1 = new ActionRowBuilder()
                .addComponents(await new SetAuthorsMenu().getBuilder(guildHolder, submission, true));
            components.push(row1);
        }
        const row2 = new ActionRowBuilder()
            .addComponents(await new AddAuthorButton().getBuilder());
        components.push(row2);
        await replyEphemeral(interaction, `<@${interaction.user.id}> Please select author(s) for the submission`, {
            components
        });
    }
}