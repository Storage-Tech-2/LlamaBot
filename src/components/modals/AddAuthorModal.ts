import { ActionRowBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { areAuthorsSame, canEditSubmission, extractUserIdsFromText, getAuthorsString, reclassifyAuthors, replyEphemeral, splitIntoChunks } from "../../utils/Util.js";
import { Author, AuthorType } from "../../submissions/Author.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { SetAuthorsButton } from "../buttons/SetAuthorsButton.js";
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

        const row1 = new ActionRowBuilder().addComponents(userIDInput)
        const row2 = new ActionRowBuilder().addComponents(name)
        modal.addComponents(row1 as any, row2)
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

        const author: Author = {
            type: AuthorType.Unknown,
            id: userId || undefined,
            username: name || 'Unknown'
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
            const user = await guildHolder.getBot().client.users.fetch(userId);
            if (!user) {
                replyEphemeral(interaction, 'User not found. Please provide a valid Discord User ID or leave it empty.');
                return;
            }
            author.username = user.username; // Use the username if available, otherwise use the provided name
            const member = await guildHolder.getGuild().members.fetch(userId).catch(() => null);
            if (member) {
                author.type = AuthorType.DiscordInGuild;
                author.displayName = member.displayName;
                author.iconURL = member.displayAvatarURL();
            } else {
                author.type = AuthorType.DiscordExternal;
                author.iconURL = user.displayAvatarURL();
            }
        }

        const isFirstTime = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) === null;

        let currentAuthors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || [];
        if (isFirstTime) {
            const message = await (await submission.getSubmissionChannel()).fetchStarterMessage();
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
                return author.type !== AuthorType.Unknown;
            });
        }

        if (currentAuthors.some(a => {
            if (a.id && author.id) {
                return a.id === author.id;
            } else {
                return a.username === author.username && a.type === author.type;
            }
        })) {
            replyEphemeral(interaction, 'This author is already in the list!');
            return;
        }

        currentAuthors.push(author);
        submission.getConfigManager().setConfig(SubmissionConfigs.AUTHORS, currentAuthors);

        const channel = await submission.getSubmissionChannel();
        channel.send({
            content: `<@${interaction.user.id}> added author: ${author.username} (${author.id ? `<@${author.id}>` : 'Unknown ID'})`,
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