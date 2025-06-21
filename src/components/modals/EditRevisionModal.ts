import { ActionRowBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, Snowflake, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { Revision, RevisionType } from "../../submissions/Revision.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { RevisionEmbed } from "../../embed/RevisionEmbed.js";

export class EditRevisionModal implements Modal {
    getID(): string {
        return "edit-revision-modal";
    }

    getBuilder(revision: Revision): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(this.getID() + '|' + revision.id)
            .setTitle('Edit Submission')

        const descriptionInput = new TextInputBuilder()
            .setCustomId('descriptionInput')
            .setLabel('Description:')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(revision.description)
            .setRequired(true)

        const featuresInput = new TextInputBuilder()
            .setCustomId('featuresInput')
            .setLabel('Features:')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(revision.features.map(o => "- " + o).join('\n'))
            .setRequired(true)

        const authorsInput = new TextInputBuilder()
            .setCustomId('consInput')
            .setLabel('Cons:')
            .setStyle(TextInputStyle.Paragraph)
            .setValue((revision.considerations || []).map(o => "- " + o).join('\n'))
            .setRequired(false)

        const notesInput = new TextInputBuilder()
            .setCustomId('notesInput')
            .setLabel('Notes:')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(revision.notes)
            .setRequired(false)

        const row1 = new ActionRowBuilder().addComponents(descriptionInput)
        const row2 = new ActionRowBuilder().addComponents(featuresInput)
        const row3 = new ActionRowBuilder().addComponents(authorsInput)
        const row4 = new ActionRowBuilder().addComponents(notesInput)
        modal.addComponents(row1 as any, row2, row3, row4)
        return modal
    }

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction, revisionId: Snowflake): Promise<void> {
        const submissionId = interaction.channelId
        if (!submissionId) {
            replyEphemeral(interaction, 'Submission ID not found')
            return
        }

        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return
        }

        if (
            !canEditSubmission(interaction, submission)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return;
        }

        const revision = await submission.getRevisionsManager().getRevisionById(revisionId)
        if (!revision) {
            replyEphemeral(interaction, 'Revision not found')
            return
        }

        const descriptionInput = interaction.fields.getTextInputValue('descriptionInput')
        const featuresInput = interaction.fields.getTextInputValue('featuresInput')
        const consInput = interaction.fields.getTextInputValue('consInput')
        const notesInput = interaction.fields.getTextInputValue('notesInput')

        const newRevisionData: Revision = {
            id: "",
            type: RevisionType.Manual,
            parentRevision: revision.id,
            timestamp: Date.now(),
            description: descriptionInput,
            features: featuresInput.split('\n').map(o => o.trim().replace(/^- /, '').trim()).filter(o => o.length > 0),
            considerations: consInput.split('\n').map(o => o.trim().replace(/^- /, '').trim()).filter(o => o.length > 0),
            notes: notesInput
        }

        const isCurrent = submission.getRevisionsManager().isRevisionCurrent(revision.id);
      
        await interaction.reply({
            content: `<@${interaction.user.id}> Manually edited the submission${isCurrent ? ' and set it as current' : ''}`
        })

        const embed = await RevisionEmbed.create(submission, newRevisionData, isCurrent);
        const messageNew = await interaction.followUp({
            embeds: [embed.getEmbed()],
            components: [embed.getRow() as any],
            flags: MessageFlags.SuppressNotifications
        })
        newRevisionData.id = messageNew.id;
        await submission.getRevisionsManager().createRevision(newRevisionData);
        if (isCurrent) {
            await submission.getRevisionsManager().setCurrentRevision(newRevisionData.id, false);
        }
        submission.statusUpdated();
    }
}