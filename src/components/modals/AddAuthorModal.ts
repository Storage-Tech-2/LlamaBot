import { ActionRowBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { areAuthorsSame, canEditSubmission, reclassifyAuthors, replyEphemeral } from "../../utils/Util.js";
import { Author, AuthorType } from "../../submissions/Author.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { SetArchiveCategoryMenu } from "../menus/SetArchiveCategoryMenu.js";
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
            .setPlaceholder('A number. Leave empty for non-Discord users')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)

        const name = new TextInputBuilder()
            .setCustomId('nameInput')
            .setLabel('or Name (for non-Discord users only):')
            .setPlaceholder('Leave empty for Discord users')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)

        
        const url = new TextInputBuilder()
            .setCustomId('urlInput')
            .setLabel('Optional URL for the author:')
            .setPlaceholder('e.g. "https://reddit.com/u/username"')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)

        const reason = new TextInputBuilder()
            .setCustomId('reasonInput')
            .setLabel('Optional reason for adding:')
            .setPlaceholder('e.g. "for emotional support"')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)

        const shouldDisplay = new TextInputBuilder()
            .setCustomId('shouldDisplay')
            .setLabel('Display in the "by" line?')
            .setStyle(TextInputStyle.Short)
            .setValue('Yes')
            .setPlaceholder('Yes/No')
            .setRequired(true)

        const row1 = new ActionRowBuilder().addComponents(userIDInput)
        const row2 = new ActionRowBuilder().addComponents(name)
        const row3 = new ActionRowBuilder().addComponents(url)
        const row4 = new ActionRowBuilder().addComponents(reason)
        const row5 = new ActionRowBuilder().addComponents(shouldDisplay)
        modal.addComponents(row1 as any, row2 as any, row3 as any, row4 as any, row5 as any);
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
        const shouldDisplay = interaction.fields.getTextInputValue('shouldDisplay').toLowerCase() === 'yes' || interaction.fields.getTextInputValue('shouldDisplay').toLowerCase() === 'y';
        const url = interaction.fields.getTextInputValue('urlInput') || undefined;
        
        let author: Author = {
            type: AuthorType.Unknown,
            id: userId || undefined,
            username: name || 'Unknown',
            reason: reason
        };

        if (!shouldDisplay) {
            author.dontDisplay = true; // If the user doesn't want to display this author, we set dontDisplay to true
        }

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

        if (url) {
            // check if the URL is valid
            try {
                new URL(url); // This will throw if the URL is invalid
            } catch (e) {
                replyEphemeral(interaction, 'Invalid URL format. Please provide a valid URL or leave it empty.');
                return;
            }
            author.url = url; // If a URL is provided, we add it to the author object
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
        if (!channel) {
            replyEphemeral(interaction, 'Submission channel not found. Please try again later.');
            return;
        }
        channel.send({
            content: `<@${interaction.user.id}> added author: ${author.username} (${author.id ? `<@${author.id}>` : 'Unknown ID'})${author.reason ? ` with reason: ${author.reason}` : ''}`,
            flags: MessageFlags.SuppressNotifications
        });

        await SetAuthorsMenu.sendAuthorsMenuAndButton(submission, interaction);

        await submission.statusUpdated();

        if (isFirstTime) {
            await SetArchiveCategoryMenu.sendArchiveCategorySelector(submission, interaction);
        }
    }
}