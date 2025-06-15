import { ActionRowBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, Snowflake, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Modal } from "../../interface/Modal";
import { Revision, RevisionType, TempRevisionData } from "../../submissions/Revision";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { AuthorType } from "../../submissions/Author";
import { RevisionEmbed } from "../../embed/RevisionEmbed";

export class EditRevisionModalPart2 implements Modal {
    getID(): string {
        return "edit-revision-modal-part-2";
    }

    async getBuilder(revision: Revision): Promise<ModalBuilder> {
        const modal = new ModalBuilder()
            .setCustomId(this.getID() + '|' + revision.id)
            .setTitle('Edit Submission')

        const descriptionInput = new TextInputBuilder()
            .setCustomId('descriptionInput')
            .setLabel('Name of the device')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(revision.description)
            .setRequired(true)

        const featuresInput = new TextInputBuilder()
            .setCustomId('featuresInput')
            .setLabel('Features of the device')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(revision.features.map(o => "- " + o).join('\n'))
            .setRequired(true)

        const authorsInput = new TextInputBuilder()
            .setCustomId('consInput')
            .setLabel('Cons of the device')
            .setStyle(TextInputStyle.Paragraph)
            .setValue((revision.considerations || []).map(o => "- " + o).join('\n'))
            .setRequired(false)

        const notesInput = new TextInputBuilder()
            .setCustomId('notesInput')
            .setLabel('Notes about the device')
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

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction, revisionId: Snowflake, ...args: any[]): Promise<void> {
        if (
            !isOwner(interaction) &&
            !hasPerms(interaction)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
            return;
        }

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

        const revision = await submission.getRevisionsManager().getRevisionById(revisionId)
        if (!revision) {
            replyEphemeral(interaction, 'Revision not found')
            return
        }

        const descriptionInput = interaction.fields.getTextInputValue('descriptionInput')
        const featuresInput = interaction.fields.getTextInputValue('featuresInput')
        const consInput = interaction.fields.getTextInputValue('consInput')
        const notesInput = interaction.fields.getTextInputValue('notesInput')

        const key = `edit-revision-${revisionId}-${interaction.user.id}`;
        const tempData = guildHolder.getBot().getTempDataStore().getEntry(key);
        if (!tempData) {
            replyEphemeral(interaction, 'Temporary data not found. Please try again.');
            return;
        }
        guildHolder.getBot().getTempDataStore().removeEntry(key);

        const tempRevisionData = tempData.data as TempRevisionData;

        const newRevisionData: Revision = {
            id: "",
            type: RevisionType.Manual,
            parentRevision: revision.id,
            timestamp: Date.now(),
            name: tempRevisionData.name,
            minecraftVersion: tempRevisionData.minecraftVersion,
            authors: tempRevisionData.authors.map(author => {
                return {
                    type: AuthorType.Unknown,
                    name: author.trim()
                }
            }),
            description: descriptionInput,
            features: featuresInput.split('\n').map(o => o.trim().replace(/^- /, '').trim()).filter(o => o.length > 0),
            considerations: consInput.split('\n').map(o => o.trim().replace(/^- /, '').trim()).filter(o => o.length > 0),
            notes: notesInput
        }

        const isCurrent = submission.getRevisionsManager().isRevisionCurrent(revision.id);
      
        await interaction.reply({
            content: `<@${interaction.user.id}> Manually edited the submission${isCurrent ? ' and set it as current' : ''}`
        })

        const embed = await RevisionEmbed.create(newRevisionData, isCurrent, false);
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
        submission.updateStatusMessage();
    }
}