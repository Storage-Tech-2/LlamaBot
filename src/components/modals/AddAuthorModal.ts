import { LabelBuilder, MessageFlags, ModalBuilder, ModalSubmitInteraction, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { areAuthorsSame, canEditSubmission, getAuthorsString, getDiscordAuthorsFromIDs, reclassifyAuthors, replyEphemeral } from "../../utils/Util.js";
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
           
            .setPlaceholder('A number. Leave empty for non-Discord users')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)

        const userIDLabel = new LabelBuilder()
            .setLabel('Discord User ID:')
            .setTextInputComponent(userIDInput);

        const name = new TextInputBuilder()
            .setCustomId('nameInput')
            .setPlaceholder('Leave empty for Discord users')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)

        const nameLabel = new LabelBuilder()
            .setLabel('or Name (for non-Discord users only):')
            .setTextInputComponent(name);

        
        const url = new TextInputBuilder()
            .setCustomId('urlInput')
            .setPlaceholder('e.g. https://reddit.com/u/username')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        
        const urlLabel = new LabelBuilder()
            .setLabel('Optional URL for the author:')
            .setTextInputComponent(url);

        const reason = new TextInputBuilder()
            .setCustomId('reasonInput')
            .setPlaceholder('e.g. "for emotional support"')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)

        const reasonLabel = new LabelBuilder()
            .setLabel('Reason for adding (optional):')
            .setTextInputComponent(reason);

        const shouldDisplay = new StringSelectMenuBuilder()
            .setCustomId('shouldDisplay')
            .setMinValues(1)
            .setMaxValues(1)
            .setOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Yes')
                    .setValue('yes')
                    .setDescription('Display this author on the by line')
                    .setDefault(true),
                new StringSelectMenuOptionBuilder()
                    .setLabel('No')
                    .setValue('no')
                    .setDescription('Do not display this author on the by line'),
            )
            .setRequired(true)

        const shouldDisplayLabel = new LabelBuilder()
            .setLabel('Display this author on the by line?')
            .setStringSelectMenuComponent(shouldDisplay);

        modal.addLabelComponents(
            userIDLabel,
            nameLabel,
            urlLabel,
            reasonLabel,
            shouldDisplayLabel
        );

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
        const shouldDisplay = interaction.fields.getStringSelectValues('shouldDisplay')[0] === 'yes';
        const url = interaction.fields.getTextInputValue('urlInput') || undefined;
        
        // let author: Author = {
        //     type: AuthorType.Unknown,
        //     id: userId || undefined,
        //     username: name || 'Unknown',
        //     reason: reason
        // };

        // if (!shouldDisplay) {
        //     author.dontDisplay = true; // If the user doesn't want to display this author, we set dontDisplay to true
        // }

        if (userId && !/^\d{17,19}$/.test(userId)) {
            replyEphemeral(interaction, 'Invalid Discord User ID format. Please provide a valid ID or leave it empty.');
            return;
        }

        if (!userId && !name) {
            replyEphemeral(interaction, 'Please provide either a Discord User ID or a name.');
            return;
        }

        let author: Author;

        if (userId) {
            // fetch user
            const user = await getDiscordAuthorsFromIDs(guildHolder, [userId]);
            if (user.length === 0) {
                replyEphemeral(interaction, 'User not found. Please provide a valid Discord User ID or leave it empty.');
                return;
            }
            author = user[0];
        } else {
            author = {
                type: AuthorType.Unknown,
                username: name,
            };
        }

        if (!shouldDisplay) {
            author.dontDisplay = true; // If the user doesn't want to display this author, we set dontDisplay to true
        }

        if (reason) {
            author.reason = reason;
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

        await interaction.deferUpdate();
        
        currentAuthors = await reclassifyAuthors(guildHolder, currentAuthors);
    
        submission.getConfigManager().setConfig(SubmissionConfigs.AUTHORS, currentAuthors);

        const channel = await submission.getSubmissionChannel();
        if (!channel) {
            replyEphemeral(interaction, 'Submission channel not found. Please try again later.');
            return;
        }
        channel.send({
            content: `<@${interaction.user.id}> added author: ${getAuthorsString([author])}${author.reason ? ` with reason: ${author.reason}` : ''}`,
            flags: MessageFlags.SuppressNotifications
        });

        await SetAuthorsMenu.sendAuthorsMenuAndButton(submission, interaction, true);

        await submission.statusUpdated();

        if (isFirstTime) {
            await SetArchiveCategoryMenu.sendArchiveCategorySelector(submission, interaction);
        }

        await submission.onAuthorsUpdated();
    }
}