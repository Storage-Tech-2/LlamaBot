import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags, ModalMessageModalSubmitInteraction } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { Submission } from "../../submissions/Submission.js";
import { EditAuthorButton } from "./EditAuthorButton.js";

export class EditAuthorsButton implements Button {
    getID(): string {
        return "edit-authors-button";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('Edit Authors')
            .setStyle(ButtonStyle.Secondary);
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

      

        await this.sendAuthorEditButtons(submission, interaction);
    }

    public async sendAuthorEditButtons(submission: Submission, interaction: ButtonInteraction | ModalMessageModalSubmitInteraction): Promise<void> {
        const currentAuthors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || [];

        if (currentAuthors.length === 0) {
            replyEphemeral(interaction, `There are no authors set for this submission.`);
            return;
        }

        const rows: ActionRowBuilder<any>[] = [];

        if (currentAuthors.length > 0) {
            rows.push(new ActionRowBuilder());
        }

        currentAuthors.forEach(author => {
            const currentRow = rows[rows.length - 1];
            const editAuthorButton = new EditAuthorButton().getBuilder(author);
            if (currentRow.components.length >= 5) {
                const newRow = new ActionRowBuilder().addComponents(editAuthorButton);
                rows.push(newRow);
            } else {
                currentRow.addComponents(editAuthorButton);
            }
        });

        if (!interaction.deferred) {
            interaction.reply({
                content: `Select the author you want to edit:`,
                components: rows,
                flags: [MessageFlags.Ephemeral],
            });
        } else {
            interaction.editReply({
                content: `Select the author you want to edit:`,
                components: rows,
            });
        }
    }

}