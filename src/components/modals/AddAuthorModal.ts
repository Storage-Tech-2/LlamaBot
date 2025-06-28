import { ActionRowBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { areAuthorsSame, canEditSubmission, getAuthorsString, reclassifyAuthors, replyEphemeral, splitIntoChunks } from "../../utils/Util.js";
import { Author, AuthorType } from "../../submissions/Author.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { SetArchiveCategoryMenu } from "../menus/SetArchiveCategoryMenu.js";
import { GuildConfigs } from "../../config/GuildConfigs.js";
import { SetAuthorsMenu } from "../menus/SetAuthorsMenu.js";

export class AddAuthorModal implements Modal {
    getID(): string {
        return "add-author-modal";
    }

    getBuilder(): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(this.getID())
            .setTitle('Add Author Manually')



        const userIDInput = new TextInputBuilder()
            .setCustomId('idInput')
            .setLabel('Discord User ID:')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)

        const name = new TextInputBuilder()
            .setCustomId('nameInput')
            .setLabel('or Name (for non-Discord users only):')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)

        const reason = new TextInputBuilder()
            .setCustomId('reasonInput')
            .setLabel('Optional reason for adding:')
            .setStyle(TextInputStyle.Paragraph)

        const shouldDisplay = new StringSelectMenuBuilder()
            .setCustomId('shouldDisplay')
            .setPlaceholder('Display seperately?')
            .setOptions([
                {
                    label: 'Yes',
                    value: 'yes',
                    description: 'Display author at the end of the post',
                },
                {
                    label: 'No',
                    value: 'no',
                    default: true,
                    description: 'Display author in the "by" line',
                }
            ])

        const row1 = new ActionRowBuilder().addComponents(userIDInput)
        const row2 = new ActionRowBuilder().addComponents(name)
        const row3 = new ActionRowBuilder().addComponents(reason)
        const row4 = new ActionRowBuilder().addComponents(shouldDisplay)
        modal.addComponents(row1 as any, row2 as any, row3 as any, row4 as any);
        return modal
    }

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction): Promise<void> {
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

        const name = interaction.fields.getTextInputValue('nameInput');
        const userId = interaction.fields.getTextInputValue('idInput') || null;
        const reason = interaction.fields.getTextInputValue('reasonInput') || undefined;
        const shouldDisplay = interaction.fields.getField('shouldDisplay');

        let author: Author = {
            type: AuthorType.Unknown,
            id: userId || undefined,
            username: name || 'Unknown',
            reason: reason,
        };

        if (userId && !/^\d{17,19}$/.test(userId)) {
            replyEphemeral(interaction, 'Invalid Discord User ID format. Please provide a valid ID or leave it empty.');
            return;
        }

        if (!userId && !name) {
            replyEphemeral(interaction, 'Please provide either a Discord User ID or a name.');
            return;
        }

        if (userId) {
            author.type = AuthorType.DiscordExternal;
            author.id = userId;
            author = (await reclassifyAuthors(guildHolder, [author]))[0];
            if (author.type === AuthorType.Unknown) {
                replyEphemeral(interaction, 'User not found. Please provide a valid Discord User ID or leave it empty.');
                return;
            }
        }

        const isFirstTime = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) === null;
        let currentAuthors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || (await submission.getPotentialAuthorsFromMessageContent())
        if (currentAuthors.some(a => {
            return areAuthorsSame(a, author);
        })) {
            replyEphemeral(interaction, 'This author is already in the list!');
            return;
        }

        currentAuthors.push(author);
        submission.getConfigManager().setConfig(SubmissionConfigs.AUTHORS, currentAuthors);

        const channel = await submission.getSubmissionChannel();
        channel.send({
            content: `<@${interaction.user.id}> added author: ${author.username} (${author.id ? `<@${author.id}>` : 'Unknown ID'})${author.reason ? ` with reason: ${author.reason}` : ''}`,
            flags: MessageFlags.SuppressNotifications
        });

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


        await SetAuthorsMenu.sendAuthorsMenuAndButton(submission, interaction);

        await submission.statusUpdated();

        if (isFirstTime) {
            const row = new ActionRowBuilder()
                .addComponents(await new SetArchiveCategoryMenu().getBuilder(guildHolder))
            await replyEphemeral(interaction, `Please select an archive category for your submission`, {
                components: [row as any],
            })
        }
    }
}