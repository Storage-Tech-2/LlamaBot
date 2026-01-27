import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { BaseAttachment } from "../../submissions/Attachment.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { SetDescriptionButton } from "./SetDescriptionButton.js";

export class EditInfoMultipleButton implements Button {
    getID(): string {
        return "edit-info-multiple-button";
    }

    getBuilder(isImage: boolean): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID() + '|' + (isImage ? 'i' : 'a'))
            .setLabel('Edit Names/Descriptions')
            .setStyle(ButtonStyle.Secondary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, type: string): Promise<void> {
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

        const isImage = type === 'i';
        const processing = isImage ? submission.imagesProcessing : submission.attachmentsProcessing;

        if (processing) {
            replyEphemeral(interaction, `${isImage ? 'Images' : 'Attachments'} are currently being processed. Please wait until they are done.`);
            return;
        }

        const currentAttachments: BaseAttachment[] = submission.getConfigManager().getConfig(isImage ? SubmissionConfigs.IMAGES : SubmissionConfigs.ATTACHMENTS) || [];

        if (currentAttachments.length === 0) {
            replyEphemeral(interaction, `There are no ${isImage ? 'images' : 'attachments'} set for this submission.`);
            return;
        }

        const rows: ActionRowBuilder<any>[] = [];

        if (currentAttachments.length > 0) {
            rows.push(new ActionRowBuilder());
        }

        currentAttachments.forEach(attachment => {
            const currentRow = rows[rows.length - 1];
            const editDescriptionButton = new SetDescriptionButton().getBuilder(attachment.name, isImage, attachment.id, '');
            if (currentRow.components.length >= 5) {
                const newRow = new ActionRowBuilder().addComponents(editDescriptionButton);
                rows.push(newRow);
            } else {
                currentRow.addComponents(editDescriptionButton);
            }
        });

        interaction.reply({
            content: `Select the ${isImage ? 'images' : 'attachments'} you want to edit:`,
            components: rows,
            flags: [MessageFlags.Ephemeral],
        });


    }
}