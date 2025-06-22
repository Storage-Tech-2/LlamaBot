import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, extractUserIdsFromText, getAuthorsString, reclassifyAuthors, replyEphemeral } from "../../utils/Util.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { Author, AuthorType } from "../../submissions/Author.js";
import { SetArchiveCategoryMenu } from "../menus/SetArchiveCategoryMenu.js";

export class ConfirmAuthorsButton implements Button {
    getID(): string {
        return "confirm-authors-button";
    }

    getBuilder(): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel('This is correct')
            .setStyle(ButtonStyle.Primary)
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

        if (submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) !== null) {
            replyEphemeral(interaction, 'Authors have already been set for this submission.');
            return;
        }

        const message = await (await submission.getSubmissionChannel()).fetchStarterMessage();
        let currentAuthors: Author[] = [];
        if (message && message.content) {
            const users = extractUserIdsFromText(message.content);
            for (const userId of users) {

                if (currentAuthors.some(author => author.id === userId)) {
                    continue; // Skip if user is already in the list
                }

                if (currentAuthors.length >= 25) {
                    break; // Limit to 25 authors
                }

                currentAuthors.push({
                    type: AuthorType.DiscordExternal,
                    id: userId
                });
            }
        }

        currentAuthors = (await reclassifyAuthors(guildHolder, currentAuthors)).filter(author => {
            return author.type !== AuthorType.Unknown
        });

        submission.getConfigManager().setConfig(SubmissionConfigs.AUTHORS, currentAuthors);


        const str = [];
        if (currentAuthors.length) {
            str.push('added ' + getAuthorsString(currentAuthors));
        }

        if (str.length) {
            await interaction.reply({
                content: `<@${interaction.user.id}> ${str.join(' and ')} to authors`,
                flags: [MessageFlags.SuppressNotifications]
            });
            await submission.statusUpdated()
        } else {
            await interaction.reply({
                content: `<@${interaction.user.id}> set zero authors`,
                flags: [MessageFlags.SuppressNotifications]
            });
        }

        const row = new ActionRowBuilder()
            .addComponents(await new SetArchiveCategoryMenu().getBuilder(guildHolder))
        await interaction.followUp({
            content: `Please select an archive category for your submission`,
            components: [row as any],
            flags: MessageFlags.Ephemeral
        })

        submission.checkReview()

    }

}