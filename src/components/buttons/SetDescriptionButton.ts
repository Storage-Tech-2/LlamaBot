import { ButtonBuilder, ButtonInteraction, ButtonStyle, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral, truncateStringWithEllipsis } from "../../utils/Util.js";
import { SetDescriptionModal } from "../modals/SetDescriptionModal.js";
import { AttachmentAskDescriptionData, BaseAttachment } from "../../submissions/Attachment.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";

export class SetDescriptionButton implements Button {
    getID(): string {
        return "set-desc-btn";
    }

    getBuilder(attachmentName: string, isImage: boolean, id: Snowflake, taskID: string): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID() + '|' + (isImage ? 'i' : 'a') + '|' + id + '|' + taskID)
            .setLabel(truncateStringWithEllipsis(taskID.length > 0 ? `Set info: ${attachmentName}` : `Edit info: ${attachmentName}` , 80))
            .setStyle(taskID.length > 0 ? ButtonStyle.Primary : ButtonStyle.Secondary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, type: string, id: Snowflake, taskID: string): Promise<void> {
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

        const data = taskID.length > 0 ? await guildHolder.getBot().getTempDataStore().getEntry(taskID) : null;
        const attachmentSetTaskData = data ? data.data as AttachmentAskDescriptionData : null;
        const currentAttachments: BaseAttachment[] = submission.getConfigManager().getConfig(isImage ? SubmissionConfigs.IMAGES : SubmissionConfigs.ATTACHMENTS) || [];

        let attachment: BaseAttachment | null = null;
        if (attachmentSetTaskData) {
            attachment = attachmentSetTaskData.toSet.find(att => att.id === id) as (BaseAttachment | null);
        } else {
            attachment = currentAttachments.find(att => att.id === id) || null;
        }

        const modal = new SetDescriptionModal().getBuilder(attachment?.name || "Unknown", attachment?.description || "", isImage, id, taskID);
        await interaction.showModal(modal);
    }
}