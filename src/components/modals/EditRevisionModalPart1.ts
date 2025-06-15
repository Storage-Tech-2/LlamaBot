import { ActionRowBuilder, ModalBuilder, ModalSubmitInteraction, Snowflake, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Modal } from "../../interface/Modal";
import { Revision, TempRevisionData } from "../../submissions/Revision";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { EditRevisionModalPart2 } from "./EditRevisionModalPart2";
import { EditOthersYesNo } from "../buttons/EditOthersYesNo";

export class EditRevisionModalPart1 implements Modal {
    getID(): string {
        return "edit-revision-modal-part-1";
    }

    async getBuilder(revision: Revision): Promise<ModalBuilder> {
        const modal = new ModalBuilder()
            .setCustomId(this.getID() + '|' + revision.id)
            .setTitle('Edit Submission')

        const nameInput = new TextInputBuilder()
            .setCustomId('nameInput')
            .setLabel('Name of the device')
            .setStyle(TextInputStyle.Short)
            .setValue(revision.name)
            .setRequired(true)

        const versionInput = new TextInputBuilder()
            .setCustomId('gameVersionInput')
            .setLabel('Game version of the device')
            .setStyle(TextInputStyle.Short)
            .setValue(revision.minecraftVersion)
            .setRequired(true)

        const authorsInput = new TextInputBuilder()
            .setCustomId('authorsInput')
            .setLabel('Authors of the device')
            .setStyle(TextInputStyle.Short)
            .setValue(revision.authors.map(o => o.name).join(', '))
            .setRequired(true)

        const row1 = new ActionRowBuilder().addComponents(nameInput)
        const row2 = new ActionRowBuilder().addComponents(versionInput)
        const row3 = new ActionRowBuilder().addComponents(authorsInput)
        modal.addComponents(row1 as any, row2, row3)
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

        const nameInput = interaction.fields.getTextInputValue('nameInput')
        const versionInput = interaction.fields.getTextInputValue('gameVersionInput')
        const authorsInput = interaction.fields.getTextInputValue('authorsInput')
        const authors = authorsInput.split(',').map(o => o.trim()).filter(o => o !== '')


        const revisionData: TempRevisionData = {
            name: nameInput,
            minecraftVersion: versionInput,
            authors: authors
        }
        guildHolder.getBot().getTempDataStore().addEntry(
            `edit-revision-${revisionId}-${interaction.user.id}`,
            revisionData,
            60 * 60 * 1000 // 60 minutes
        )

        const yesButton = await new EditOthersYesNo().getBuilder(true, revision)
        const noButton = await new EditOthersYesNo().getBuilder(false, revision)
        await replyEphemeral(interaction, `Do you want to also edit the description, features, considerations, and notes of the revision?`,
            {
                components: [
                    (new ActionRowBuilder().addComponents(yesButton, noButton)) as any
                ]
            }
        );
    }
}