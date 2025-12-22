import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType, ChannelType, ForumChannel } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { isEditor, isEndorser, isModerator, replyEphemeral } from "../utils/Util.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs.js";
import { SubmissionStatus } from "../submissions/SubmissionStatus.js";

export class EditorPowersCommand implements Command {
    getID(): string {
        return "editorpowers";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Special powers for editors')
            .setContexts(InteractionContextType.Guild)
            .addSubcommand(subcommand =>
                subcommand
                    .setName('clearendorsements')
                    .setDescription('Clear all endorsements from a submission')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('lock')
                    .setDescription('Prevent further edits to a submission')
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for locking the submission')
                            .setRequired(false)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('unlock')
                    .setDescription('Allow further edits to a submission')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('retract')
                    .setDescription('Unarchive/retract a submission')
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for retracting the submission')
                            .setRequired(false)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('hold')
                    .setDescription('Hold a submission for review')
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for holding the submission')
                            .setRequired(false)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('unhold')
                    .setDescription('Unhold a submission')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('reject')
                    .setDescription('Reject a submission permanently')
                    .addStringOption(option =>
                        option.setName('reason')
                            .setDescription('Reason for rejecting the submission')
                            .setRequired(false)
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('publishsilently')
                    .setDescription('Publish a submission without an archive-updates message')
                    .addBooleanOption(option =>
                        option.setName('refresh')
                            .setDescription('Force remaking the post thread entirely')
                    )
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('announce')
                    .setDescription('Announce a submission to subscribed users and channels')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('closeposts')
                    .setDescription('Close all open threads in the archive')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('closesubmissions')
                    .setDescription('Close all open threads in submissions')
            );

        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (
            !interaction.inGuild()
        ) {
            replyEphemeral(interaction, 'This command can only be used in a guild.')
            return;
        }

        // Check if user has endorse role

        const subcommand = interaction.options.getSubcommand();
        const isPrivileged = isEditor(interaction, guildHolder) || isModerator(interaction);
        if (!isPrivileged && !(subcommand === 'unlock' && isEndorser(interaction, guildHolder))) {
            replyEphemeral(interaction, 'You do not have permission to use this command!');
            return;
        }

        if (subcommand === 'closeposts') {
            await this.closeEverythingPosts(guildHolder, interaction);
            return;
        }

        if (subcommand === 'closesubmissions') {
            await this.closeEverythingSubmissions(guildHolder, interaction);
            return;
        }

        const channelId = interaction.channelId;
        const submission = await guildHolder.getSubmissionsManager().getSubmission(channelId);
        if (!submission) {
            replyEphemeral(interaction, 'You can only use this command in a submission channel.');
            return;
        }

        switch (subcommand) {
            case 'clearendorsements':
                const endorsements = submission.getConfigManager().getConfig(SubmissionConfigs.ENDORSERS);
                if (endorsements.length === 0) {
                    replyEphemeral(interaction, 'No endorsements to clear.');
                    return;
                }
                submission.getConfigManager().setConfig(SubmissionConfigs.ENDORSERS, []);
                await submission.statusUpdated();
                await interaction.reply({
                    content: `<@${interaction.user.id}> has cleared all endorsements from this submission.`,
                });
                break;
            case 'lock': {
                if (submission.getConfigManager().getConfig(SubmissionConfigs.IS_LOCKED)) {
                    replyEphemeral(interaction, 'Submission is already locked.');
                    return;
                }
                const reason = interaction.options.getString('reason') || '';
                submission.getConfigManager().setConfig(SubmissionConfigs.IS_LOCKED, true);
                submission.getConfigManager().setConfig(SubmissionConfigs.LOCK_REASON, reason);
                await submission.statusUpdated();
                await interaction.reply({
                    content: `<@${interaction.user.id}> has locked this submission. No further edits are allowed. Reason: ${reason || 'No reason provided'}`,
                });
                break;
            }
            case 'unlock':
                if (!submission.getConfigManager().getConfig(SubmissionConfigs.IS_LOCKED)) {
                    replyEphemeral(interaction, 'Submission is not locked.');
                    return;
                }
                submission.getConfigManager().setConfig(SubmissionConfigs.IS_LOCKED, false);
                await submission.statusUpdated();
                await interaction.reply({
                    content: `<@${interaction.user.id}> has unlocked this submission. Further edits are allowed.`,
                });
                break;
            case 'hold': {
                if (submission.getConfigManager().getConfig(SubmissionConfigs.ON_HOLD)) {
                    replyEphemeral(interaction, 'Submission is already on hold.');
                    return;
                }

                const reason = interaction.options.getString('reason') || '';
                submission.getConfigManager().setConfig(SubmissionConfigs.ON_HOLD, true);
                submission.getConfigManager().setConfig(SubmissionConfigs.HOLD_REASON, reason);
                await submission.statusUpdated();
                await interaction.reply({
                    content: `<@${interaction.user.id}> has put this submission on hold. It will not be published until the hold is released. Reason: ${reason || 'No reason provided'}`,
                });
                break;
            }
            case 'unhold':
                if (!submission.getConfigManager().getConfig(SubmissionConfigs.ON_HOLD)) {
                    replyEphemeral(interaction, 'Submission is not on hold.');
                    return;
                }
                submission.getConfigManager().setConfig(SubmissionConfigs.ON_HOLD, false);
                await submission.statusUpdated();
                await interaction.reply({
                    content: `<@${interaction.user.id}> has released the hold on this submission. It can now be published when ready.`,
                });
                break;
            case 'retract': {
                if (submission.getConfigManager().getConfig(SubmissionConfigs.STATUS) !== SubmissionStatus.ACCEPTED) {
                    replyEphemeral(interaction, 'Submission is not archived, cannot retract.');
                    return;
                }
                const reason = interaction.options.getString('reason') || '';

                interaction.deferReply();

                submission.getConfigManager().setConfig(SubmissionConfigs.RETRACTION_REASON, reason);
                try {
                    await submission.retract();
                } catch (e: any) {
                    console.error(e);
                    interaction.editReply({
                        content: `Failed to retract submission: ${e.message || 'Unknown error'}`,
                    });
                    return;
                }
                submission.getConfigManager().setConfig(SubmissionConfigs.STATUS, SubmissionStatus.RETRACTED);

                await submission.statusUpdated();
                await interaction.editReply({
                    content: `<@${interaction.user.id}> has retracted this submission. It is no longer archived. Note that the submission can be re-archived once issues are resolved. Reason: ${reason || 'No reason provided'}`,
                });

                break;
            }
            case 'reject': {
                if (submission.getConfigManager().getConfig(SubmissionConfigs.STATUS) === SubmissionStatus.ACCEPTED) {
                    replyEphemeral(interaction, 'Submission is already archived, cannot reject.');
                    return;
                }
                const reason = interaction.options.getString('reason') || '';
                submission.getConfigManager().setConfig(SubmissionConfigs.STATUS, SubmissionStatus.REJECTED);
                submission.getConfigManager().setConfig(SubmissionConfigs.REJECTION_REASON, reason);
                await submission.statusUpdated();
                await interaction.reply({
                    content: `<@${interaction.user.id}> has rejected this submission. It cannot be archived in the future without a new post. Reason: ${reason || 'No reason provided'}`,
                });
                break;
            }
            case 'publishsilently':
                if (!submission.isPublishable()) {
                    replyEphemeral(interaction, 'Submission is not publishable yet!');
                    return;
                }
                const refresh = interaction.options.getBoolean('refresh') || false;
                await interaction.deferReply();
                try {
                    await submission.publish(true, refresh);
                } catch (e: any) {
                    console.error(e);
                    interaction.editReply(`Failed to publish submission: ${e.message || 'Unknown error'}`);
                    return;
                }
                const url = submission.getConfigManager().getConfig(SubmissionConfigs.POST)?.threadURL;

                await interaction.editReply({
                    content: `<@${interaction.user.id}> has published this submission silently! ${url}\nNote that the submission has been locked to prevent further edits. Contact an editor/endorser if you need to make changes.`,
                });
                break;
            case 'announce':
                await interaction.deferReply();
                const channel = await submission.getSubmissionChannel();
                if (!channel) {
                    interaction.editReply('Submission channel not found.');
                    return;
                }
                await submission.sendNotificationsToSubscribers(channel);
                await interaction.editReply('Announcement sent to all subscribed users and channels.');
                break;
            default:
                replyEphemeral(interaction, 'Invalid subcommand. Please use one of the available subcommands.');
                return;
        }
    }

    async closeEverythingPosts(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        await interaction.reply('Starting to close all threads. This may take a while depending on the number of open threads. You will be notified when it is complete.');

        const currentCategories = guildHolder.getConfigManager().getConfig(GuildConfigs.ARCHIVE_CATEGORY_IDS);
        const allchannels = await guildHolder.getGuild().channels.fetch();
        const channels = allchannels.filter(channel => {
            return channel && channel.type === ChannelType.GuildForum && channel.parentId && currentCategories.includes(channel.parentId);
        }) as unknown as ForumChannel[];

        for (const channel of channels.values()) {
            const threads = await channel.threads.fetchActive();
            for (const thread of threads.threads.values()) {
                try {
                    await thread.setArchived(true, 'Closing thread as part of closeEverything command');
                } catch (error) {
                    console.error(`Error closing thread ${thread.name} (${thread.id}):`, error);
                }
            }
        }

        await interaction.followUp(`<@${interaction.user.id}> Closing all threads complete!`);
    }

    async closeEverythingSubmissions(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const submissionChannelId = guildHolder.getConfigManager().getConfig(GuildConfigs.SUBMISSION_CHANNEL_ID);
        if (!submissionChannelId) {
            await replyEphemeral(interaction, 'Submission channel is not set. Please set it using `/mwa setsubmissions` command.');
            return;
        }
        const submissionChannel = await guildHolder.getGuild().channels.fetch(submissionChannelId);
        if (!submissionChannel || submissionChannel.type !== ChannelType.GuildForum) {
            await replyEphemeral(interaction, 'Submission channel is not a valid forum channel. Please set it using `/mwa setsubmissions` command.');
            return;
        }

        await interaction.reply('Starting to close all submission channels. This may take a while depending on the number of open submissions. You will be notified when it is complete.');

        const threads = await submissionChannel.threads.fetchActive();
        const blacklist = [SubmissionStatus.NEW, SubmissionStatus.WAITING, SubmissionStatus.NEED_ENDORSEMENT];
        for (const thread of threads.threads.values()) {
            const id = thread.id;
            const submission = await guildHolder.getSubmissionsManager().getSubmission(id);
            if (submission && blacklist.includes(submission.getConfigManager().getConfig(SubmissionConfigs.STATUS))) {
                continue;
            }

            try {
                await thread.setArchived(true, 'Closing submission as part of closeEverything command');
            } catch (error) {
                console.error(`Error closing submission ${thread.name} (${thread.id}):`, error);
            }
        }
        await interaction.followUp(`<@${interaction.user.id}> Closing all submissions complete!`);
    }
}
