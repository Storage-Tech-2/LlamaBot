import { ActionRowBuilder, ModalBuilder, ModalSubmitInteraction, Snowflake, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { Revision, RevisionType } from "../../submissions/Revision.js";
import { canEditSubmission, replyEphemeral, splitIntoChunks } from "../../utils/Util.js";
import { RevisionEmbed } from "../../embed/RevisionEmbed.js";
import { markdownMatchSchema, schemaToMarkdownTemplate } from "../../utils/MarkdownUtils.js";
import { FixErrorsButton } from "../buttons/FixErrorsButton.js";

export class EditRevisionModal implements Modal {
    getID(): string {
        return "edit-revision-modal";
    }

    getBuilder(guildHolder: GuildHolder, revision: Revision, storedID?: Snowflake): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(this.getID() + '|' + revision.id)
            .setTitle('Edit Submission')

        const descriptionInput = new TextInputBuilder()
            .setCustomId('input')
            .setLabel('Markdown Text:')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)

        const descriptionInput2 = new TextInputBuilder()
            .setCustomId('input')
            .setLabel('Markdown Text Continued:')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)

        let preset = '';
        if (storedID) {
            const tempData = guildHolder.getBot().getTempDataStore().getEntry(storedID);
            if (tempData) {
               preset = tempData.data;
            }
        }

        if (preset.length === 0) {
            preset = schemaToMarkdownTemplate(guildHolder.getSchema(), revision.records, true);
        }

        const split = splitIntoChunks(preset, 4000);
        if (split.length > 1) {
            descriptionInput.setValue(split[0]);
            descriptionInput2.setValue(split[1]);
        } else {
            descriptionInput.setValue(preset);
        }

        const row1 = new ActionRowBuilder().addComponents(descriptionInput);
        const row2 = new ActionRowBuilder().addComponents(descriptionInput2);
        modal.addComponents(row1 as any, row2 as any);
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

        const input1 = interaction.fields.getTextInputValue('input');
        const input2 = interaction.fields.getTextInputValue('input2');
        const input = input1 + (input2 ? '\n' + input2 : ''); 

        let records;

        try {
            records = markdownMatchSchema(input, guildHolder.getSchema());
        } catch (error: any) {

            // store
            const tempid = guildHolder.getBot().getTempDataStore().getNewId();
            guildHolder.getBot().getTempDataStore().addEntry(tempid, input, 60 * 60 * 1000); // Store for 1 hour
            const fixErrorsButton = new FixErrorsButton().getBuilder(revision, tempid);
            const row = new ActionRowBuilder().addComponents(fixErrorsButton);
            replyEphemeral(interaction, `Invalid input: ${error.message}`, {
                components: [row]
            });
            return;
        }
     

        const newRevisionData: Revision = {
            id: "",
            messageIds: [],
            type: RevisionType.Manual,
            parentRevision: revision.id,
            timestamp: Date.now(),
            records
        }

        const isCurrent = submission.getRevisionsManager().isRevisionCurrent(revision.id);
      
        await interaction.reply({
            content: `<@${interaction.user.id}> Manually edited the submission${isCurrent ? ' and set it as current' : ''}`
        })

        if (!interaction.channel?.isSendable()) {
            replyEphemeral(interaction, 'Cannot send messages in this channel');
            return;
        }

        const messages = await RevisionEmbed.sendRevisionMessages(interaction.channel, submission, newRevisionData, isCurrent);
      
        newRevisionData.id = messages[messages.length - 1].id; // Use the last message ID as the revision ID
        newRevisionData.messageIds = messages.map(m => m.id);
        await submission.getRevisionsManager().createRevision(newRevisionData);
        if (isCurrent) {
            await submission.getRevisionsManager().setCurrentRevision(newRevisionData.id, false);
        }
        submission.statusUpdated();
    }
}