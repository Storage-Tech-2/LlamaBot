import { ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { EditRevisionModalPart1 } from "../modals/EditRevisionModalPart1";
import { Revision, RevisionType, TempRevisionData } from "../../submissions/Revision";
import { EditRevisionModalPart2 } from "../modals/EditRevisionModalPart2";
import { AuthorType } from "../../submissions/Author";
import { RevisionEmbed } from "../../embed/RevisionEmbed";

export class EditOthersYesNo implements Button {
    getID(): string {
        return "edit-others-yes-no";
    }

    async getBuilder(isYes: boolean, revision: Revision): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID() + "|" + (isYes ? 'y' : 'n') + "|" + revision.id)
            .setLabel(isYes ? 'Yes' : 'No')
            .setStyle(ButtonStyle.Primary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, isYes: string, revisionId: Snowflake, ...args: string[]): Promise<void> {
        if (!isOwner(interaction) && !hasPerms(interaction)) {
            replyEphemeral(interaction, "You do not have permission to use this!");
            return;
        }

        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, "Submission not found");
            return;
        }

        const revision = await submission.getRevisionsManager().getRevisionById(revisionId)
        if (!revision) {
            replyEphemeral(interaction, 'Revision not found')
            return
        }

        if (isYes === 'y') {
            await interaction.showModal(await new EditRevisionModalPart2().getBuilder(revision))
        } else {
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
                description: revision.description,
                features: revision.features.slice(),
                considerations: revision.considerations.slice(),
                notes: revision.notes
            }

            const isCurrent = submission.getRevisionsManager().isRevisionCurrent(revision.id);

            await interaction.reply({
                content: `<@${interaction.user.id}> Manually edited the submission`
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

        }
    }
}