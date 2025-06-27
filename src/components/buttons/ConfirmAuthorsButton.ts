import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { areAuthorsSame, canEditSubmission, getAuthorsString, reclassifyAuthors, replyEphemeral, splitIntoChunks } from "../../utils/Util.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { Author, AuthorType } from "../../submissions/Author.js";
import { SetArchiveCategoryMenu } from "../menus/SetArchiveCategoryMenu.js";
import { GuildConfigs } from "../../config/GuildConfigs.js";

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

        let currentAuthors: Author[] = await submission.getPotentialAuthorsFromMessageContent();
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
        const blacklist = guildHolder.getConfigManager().getConfig(GuildConfigs.BLACKLISTED_USERS);
        const blacklistedAuthors = blacklist.filter(entry => {
            return currentAuthors.some(b => areAuthorsSame(b, entry.author));
        });
        if (blacklistedAuthors.length > 0) {
            const msg = `Warning: The following authors are on the Do-not-archive list:\n` + blacklistedAuthors.map(entry => {
                return `- ${getAuthorsString([entry.author])}: ${entry.reason || 'No reason provided'}`;
            }).join('\n');
            const split = splitIntoChunks(msg, 2000);
            for (let i = 0; i < split.length; i++) {
                if (!interaction.replied) {
                    await interaction.reply({
                        content: split[0],
                        flags: [MessageFlags.SuppressNotifications]
                    });
                } else {
                    await interaction.followUp({
                        content: split[i],
                        flags: [MessageFlags.SuppressNotifications]
                    });
                }
            }
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