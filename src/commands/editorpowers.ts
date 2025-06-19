import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType } from "discord.js";
import { GuildHolder } from "../GuildHolder";
import { Command } from "../interface/Command";
import { isEndorser, replyEphemeral } from "../utils/Util";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs";

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
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('unlock')
                    .setDescription('Allow further edits to a submission')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('unarchive')
                    .setDescription('Unarchive a submission')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('hold')
                    .setDescription('Hold a submission for review')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('unhold')
                    .setDescription('Unhold a submission')
            )

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
        if (
            !isEndorser(interaction, guildHolder)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this command!');
            return;
        }

        const channelId = interaction.channelId;
        const submission = await guildHolder.getSubmissionsManager().getSubmission(channelId);
        if (!submission) {
            replyEphemeral(interaction, 'You can only use this command in a submission channel.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();
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
            case 'lock':
                if (submission.getConfigManager().getConfig(SubmissionConfigs.IS_LOCKED)) {
                    replyEphemeral(interaction, 'Submission is already locked.');
                    return;
                }
                submission.getConfigManager().setConfig(SubmissionConfigs.IS_LOCKED, true);
                await submission.statusUpdated();
                await interaction.reply({
                    content: `<@${interaction.user.id}> has locked this submission. No further edits are allowed.`,
                });
                break;
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
            case 'hold':
                if (submission.getConfigManager().getConfig(SubmissionConfigs.ON_HOLD)) {
                    replyEphemeral(interaction, 'Submission is already on hold.');
                    return;
                }
                submission.getConfigManager().setConfig(SubmissionConfigs.ON_HOLD, true);
                await submission.statusUpdated();
                await interaction.reply({
                    content: `<@${interaction.user.id}> has put this submission on hold. It will not be published until the hold is released.`,
                });
                break;
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
            case 'unarchive':
                break;
            default:
                replyEphemeral(interaction, 'Unknown subcommand');
                return;
        }
    }

}