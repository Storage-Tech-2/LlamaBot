import { ActionRowBuilder, Interaction, Message, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, UserSelectMenuBuilder, UserSelectMenuInteraction } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Menu } from "../../interface/Menu.js";
import { areAuthorsSame, canEditSubmission, getAuthorName, getAuthorsString, getDiscordAuthorsFromIDs, reclassifyAuthors, replyEphemeral } from "../../utils/Util.js";
import { Author, AuthorType } from "../../submissions/Author.js";
import { Submission } from "../../submissions/Submission.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";
import { SetArchiveCategoryMenu } from "./SetArchiveCategoryMenu.js";
import { ConfirmAuthorsButton } from "../buttons/ConfirmAuthorsButton.js";
import { AddAuthorButton } from "../buttons/AddAuthorButton.js";

export class SetAuthorsMenu implements Menu {
    getID(): string {
        return "set-authors-menu";
    }

    async getBuilder(guildHolder: GuildHolder, submission: Submission, isExtra: boolean): Promise<UserSelectMenuBuilder | StringSelectMenuBuilder> {
        let currentAuthors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS);

        if (currentAuthors === null) {
            currentAuthors = (isExtra ? [] : await submission.getPotentialAuthorsFromMessageContent())
        }

        if (isExtra) {
            const extraAuthors = currentAuthors.filter(author => {
                return author.type === AuthorType.Unknown || author.type === AuthorType.DiscordDeleted;
            });
            const userSize = currentAuthors.length;
            return new StringSelectMenuBuilder()
                .setCustomId(this.getID() + "|e")
                .setMinValues(0)
                .setMaxValues(Math.min(userSize, 25))
                .setPlaceholder('Select authors')
                .setOptions(extraAuthors.map(author => {
                    const opt = new StringSelectMenuOptionBuilder();
                    opt.setLabel(getAuthorName(author) || 'Unknown Author');
                    opt.setValue(author.username || 'unknown-author');
                    opt.setDefault(extraAuthors.some(a => a.username === author.username));
                    return opt;
                }))
        } else {
            const discordAuthors = currentAuthors.filter(author => {
                return author.type !== AuthorType.Unknown && author.type !== AuthorType.DiscordDeleted;
            });
            // get list of users
            const userSize = Math.max(guildHolder.getGuild().members.cache.size, discordAuthors.length);
            return new UserSelectMenuBuilder()
                .setCustomId(this.getID() + "|d")
                .setMinValues(0)
                .setMaxValues(Math.min(userSize, 25))
                .setPlaceholder('Select authors')
                .setDefaultUsers(discordAuthors.map(author => author.id || '').filter(id => !!id))
        }
    }

    async execute(guildHolder: GuildHolder, interaction: UserSelectMenuInteraction, extra: string): Promise<void> {
        const isExtra = extra === 'e';
        if (isExtra) {
            return this.executeExtra(guildHolder, interaction);
        } else {
            return this.executeDiscord(guildHolder, interaction);
        }
    }

    async executeDiscord(guildHolder: GuildHolder, interaction: UserSelectMenuInteraction): Promise<void> {
        const submissionId = interaction.channelId
        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return
        }

        if (!canEditSubmission(interaction, submission)) {
            replyEphemeral(interaction, 'You do not have permission to use this menu!');
            return;
        }

        const configAuthors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS);
        const isFirstTime = configAuthors === null;
        let currentAuthors = configAuthors || [];
        if (isFirstTime) {
            currentAuthors = await submission.getPotentialAuthorsFromMessageContent();
        }
        const newAuthors = await getDiscordAuthorsFromIDs(guildHolder, interaction.values);

        const added: Author[] = [];
        const removed: Author[] = [];
        for (const author of newAuthors) {
            if (isFirstTime || !currentAuthors.some(a => areAuthorsSame(a, author))) {
                added.push(author);
            }
        }

        for (const author of currentAuthors) {
            if (!newAuthors.some(a => areAuthorsSame(a, author))) {
                removed.push(author);
            }
        }

        if (added.length === 0 && removed.length === 0) {
            replyEphemeral(interaction, 'No changes made to authors');
            return;
        }

        if (isFirstTime) {
            currentAuthors = newAuthors;
        } else {
            added.forEach(author => {
                currentAuthors.push(author);
            });
            removed.forEach(author => {
                const index = currentAuthors.findIndex(a => areAuthorsSame(a, author));
                if (index !== -1) {
                    currentAuthors.splice(index, 1);
                }
            });
        }

        currentAuthors = await reclassifyAuthors(guildHolder, currentAuthors);

        submission.getConfigManager().setConfig(SubmissionConfigs.AUTHORS, currentAuthors);

        const str = [];
        if (added.length) {
            str.push('added ' + getAuthorsString(added));
        }
        if (removed.length) {
            str.push('removed ' + getAuthorsString(removed));
        }

        if (str.length) {
            await interaction.reply({
                content: `<@${interaction.user.id}> ${str.join(' and ')} to authors`,
                flags: [MessageFlags.SuppressNotifications]
            });
            await submission.statusUpdated()
        } else {
            await interaction.reply({
                content: `<@${interaction.user.id}> did not change authors`,
                flags: [MessageFlags.SuppressNotifications]
            });
        }

        if (isFirstTime) {
            await SetArchiveCategoryMenu.sendArchiveCategorySelector(submission, interaction);
        }

        submission.checkReview();
        await submission.updateRevisions();
    }


    async executeExtra(guildHolder: GuildHolder, interaction: UserSelectMenuInteraction): Promise<void> {
        const submissionId = interaction.channelId
        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return
        }

        if (!canEditSubmission(interaction, submission)) {
            replyEphemeral(interaction, 'You do not have permission to use this menu!');
            return;
        }

        const isFirstTime = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) === null;
        const currentAuthors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || [];

        const newAuthors = interaction.values.map((name) => {
            const existingAuthor = currentAuthors.find(a => a.type === AuthorType.Unknown && a.username === name);
            if (existingAuthor) {
                return existingAuthor;
            }

            const newAuthor: Author = {
                type: AuthorType.Unknown,
                username: name
            }

            return newAuthor;
        }).filter(author => author !== null);

        const added: Author[] = [];
        const removed: Author[] = [];

        for (const author of newAuthors) {
            if (!currentAuthors.some(a => a.type === AuthorType.Unknown && a.username === author.username)) {
                added.push(author);
            }
        }

        for (const author of currentAuthors) {
            if (author.type === AuthorType.Unknown && !newAuthors.some(a => a.username === author.username)) {
                removed.push(author);
            }
        }

        if (added.length === 0 && removed.length === 0) {
            replyEphemeral(interaction, 'No changes made to authors');
            return;
        }

        added.forEach(author => {
            currentAuthors.push(author);
        });
        removed.forEach(author => {
            const index = currentAuthors.findIndex(a => a.type === AuthorType.Unknown && a.username === author.username);
            if (index !== -1) {
                currentAuthors.splice(index, 1);
            }
        });

        submission.getConfigManager().setConfig(SubmissionConfigs.AUTHORS, currentAuthors);

        const str = [];
        if (added.length) {
            str.push('added ' + added.map(a => a.username).join(', '));
        }
        if (removed.length) {
            str.push('removed ' + removed.map(a => a.username).join(', '));
        }

        if (str.length) {
            await interaction.reply({
                content: `<@${interaction.user.id}> ${str.join(' and ')} to authors`,
                flags: [MessageFlags.SuppressNotifications]
            });
            await submission.statusUpdated()
        }

        if (isFirstTime) {
            await SetArchiveCategoryMenu.sendArchiveCategorySelector(submission, interaction);
        }

        submission.checkReview();
        await submission.onAuthorsUpdated();
    }

    public static async sendAuthorsMenuAndButton(submission: Submission, interaction: Interaction): Promise<Message> {
        const guildHolder = submission.getGuildHolder();
        const components = [];
        const row = new ActionRowBuilder()
            .addComponents(await new SetAuthorsMenu().getBuilder(guildHolder, submission, false));
        components.push(row);

        const configAuthors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS);
        const isFirstTime = configAuthors === null;

        let currentAuthors = await reclassifyAuthors(guildHolder, configAuthors || []);
        if (currentAuthors.length > 0) {
            submission.getConfigManager().setConfig(SubmissionConfigs.AUTHORS, currentAuthors);
        }

        const extraAuthors = currentAuthors.filter(author => {
            return author.type === AuthorType.Unknown || author.type === AuthorType.DiscordDeleted;
        });
        
        if (extraAuthors.length > 0) {
            const row1 = new ActionRowBuilder()
                .addComponents(await new SetAuthorsMenu().getBuilder(guildHolder, submission, true));
            components.push(row1);
        }

        const row2 = new ActionRowBuilder();
        if (isFirstTime) {
            row2.addComponents(new ConfirmAuthorsButton().getBuilder());
        }
        row2.addComponents(new AddAuthorButton().getBuilder());
        components.push(row2);
        return replyEphemeral(interaction, `Please select author(s) for the submission. They will also be able to edit this submission.`, {
            components
        });
    }

}