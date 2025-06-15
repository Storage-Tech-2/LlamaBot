import { ActionRowBuilder, MessageFlags, StringSelectMenuBuilder, StringSelectMenuInteraction, StringSelectMenuOptionBuilder, UserSelectMenuBuilder, UserSelectMenuInteraction } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Menu } from "../../interface/Menu";
import { hasPerms, replyEphemeral } from "../../utils/Util";
import { Author, AuthorType } from "../../submissions/Author";
import { Submission } from "../../submissions/Submission";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs";
import { SetArchiveCategoryMenu } from "./SetArchiveCategoryMenu";

export class SetAuthorsMenu implements Menu {
    getID(): string {
        return "set-authors-menu";
    }

    async getBuilder(guildHolder: GuildHolder, submission: Submission, isExtra: boolean): Promise<UserSelectMenuBuilder | StringSelectMenuBuilder> {
        const currentAuthors = (submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || []).filter(author => {
            if (isExtra) {
                return author.type === AuthorType.Unknown;
            } else {
                return author.type === AuthorType.Discord
            }
        });

        if (isExtra) {
            const userSize = currentAuthors.length;
            return new StringSelectMenuBuilder()
                .setCustomId(this.getID() + "|e")
                .setMinValues(0)
                .setMaxValues(Math.min(userSize, 25))
                .setPlaceholder('Select authors')
                .setOptions(currentAuthors.map(author => {
                    const opt = new StringSelectMenuOptionBuilder();
                    opt.setLabel(author.name || 'Unknown Author');
                    opt.setValue(author.name || 'unknown-author');
                    opt.setDefault(currentAuthors.some(a => a.name === author.name));
                    return opt;
                }))
        } else {
            // get list of users
            const userSize = Math.max(guildHolder.getGuild().members.cache.size, currentAuthors.length);
            return new UserSelectMenuBuilder()
                .setCustomId(this.getID() + "|d")
                .setMinValues(0)
                .setMaxValues(Math.min(userSize, 25))
                .setPlaceholder('Select authors')
                .setDefaultUsers(currentAuthors.map(author => author.id || '').filter(id => !!id))
        }
    }

    async execute(guildHolder: GuildHolder, interaction: UserSelectMenuInteraction, extra: string, ...args: string[]): Promise<void> {
        const isExtra = extra === 'e';
        if (isExtra) {
            return this.executeExtra(guildHolder, interaction, ...args);
        } else {
            return this.executeDiscord(guildHolder, interaction, ...args);
        }
    }

    async executeDiscord(guildHolder: GuildHolder, interaction: UserSelectMenuInteraction, ...args: string[]): Promise<void> {
        if (!hasPerms(interaction)) {
            replyEphemeral(interaction, 'You do not have permission to use this menu!');
            return;
        }

        const submissionId = interaction.channelId
        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return
        }

        const isFirstTime = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) === null;
        const currentAuthors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || [];

        const newAuthors = (await Promise.all(interaction.values.map(async (id) => {
            let user = await guildHolder.getGuild().members.fetch(id).catch(() => null);
            if (!user) {
                const current = currentAuthors.find(a => a.id === id);
                if (current) {
                    return current; // Keep the current author if the user is not found
                } else {
                    return null;
                }
            }
            return {
                type: AuthorType.Discord,
                id: user.id,
                name: user.user.username
            }
        }))).filter(author => author !== null) as Author[];

        const added: Author[] = [];
        const removed: Author[] = [];
        for (const author of newAuthors) {
            if (!currentAuthors.some(a => a.id === author.id)) {
                added.push(author);
            }
        }

        for (const author of currentAuthors) {
            if (author.type === AuthorType.Discord && !newAuthors.some(a => a.id === author.id)) {
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
            const index = currentAuthors.findIndex(a => a.id === author.id);
            if (index !== -1) {
                currentAuthors.splice(index, 1);
            }
        });

        submission.getConfigManager().setConfig(SubmissionConfigs.AUTHORS, currentAuthors);

        const str = [];
        if (added.length) {
            str.push('added ' + added.map(a => `<@${a.id}>`).join(', '));
        }
        if (removed.length) {
            str.push('removed ' + removed.map(a => `<@${a.id}>`).join(', '));
        }

        if (str.length) {
            await interaction.reply({
                content: `<@${interaction.user.id}> ${str.join(' and ')} to authors`,
                flags: [MessageFlags.SuppressNotifications]
            });
            submission.statusUpdated()
        }

        if (isFirstTime) {
            const row = new ActionRowBuilder()
                .addComponents(await new SetArchiveCategoryMenu().getBuilder(guildHolder))
            await interaction.followUp({
                content: `<@${interaction.user.id}> Please select an archive category for your submission`,
                components: [row as any],
                flags: MessageFlags.Ephemeral
            })
        }

        submission.checkReview()
    }


    async executeExtra(guildHolder: GuildHolder, interaction: UserSelectMenuInteraction, ...args: string[]): Promise<void> {
        if (!hasPerms(interaction)) {
            replyEphemeral(interaction, 'You do not have permission to use this menu!');
            return;
        }

        const submissionId = interaction.channelId
        const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId)
        if (!submission) {
            replyEphemeral(interaction, 'Submission not found')
            return
        }

        const isFirstTime = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) === null;
        const currentAuthors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || [];

        const newAuthors = (await Promise.all(interaction.values.map(async (name) => {
            const existingAuthor = currentAuthors.find(a => a.type === AuthorType.Unknown && a.name === name);
            return existingAuthor || {
                type: AuthorType.Unknown,
                id: null, // No ID for unknown authors
                name: name
            }
        }))).filter(author => author !== null) as Author[];

        const added: Author[] = [];
        const removed: Author[] = [];

        for (const author of newAuthors) {
            if (!currentAuthors.some(a => a.type === AuthorType.Unknown && a.name === author.name)) {
                added.push(author);
            }
        }

        for (const author of currentAuthors) {
            if (author.type === AuthorType.Unknown && !newAuthors.some(a => a.name === author.name)) {
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
            const index = currentAuthors.findIndex(a => a.type === AuthorType.Unknown && a.name === author.name);
            if (index !== -1) {
                currentAuthors.splice(index, 1);
            }
        });

        submission.getConfigManager().setConfig(SubmissionConfigs.AUTHORS, currentAuthors);

        const str = [];
        if (added.length) {
            str.push('added ' + added.map(a => a.name).join(', '));
        }
        if (removed.length) {
            str.push('removed ' + removed.map(a => a.name).join(', '));
        }

        if (str.length) {
            await interaction.reply({
                content: `<@${interaction.user.id}> ${str.join(' and ')} to authors`,
                flags: [MessageFlags.SuppressNotifications]
            });
            submission.statusUpdated()
        }

        if (isFirstTime) {
            const row = new ActionRowBuilder()
                .addComponents(await new SetArchiveCategoryMenu().getBuilder(guildHolder))
            await interaction.followUp({
                content: `<@${interaction.user.id}> Please select an archive category for your submission`,
                components: [row as any],
                flags: MessageFlags.Ephemeral
            })
        }

        submission.checkReview()
    }

}