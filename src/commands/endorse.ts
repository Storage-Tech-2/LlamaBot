import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, InteractionContextType, ChannelType, ActionRowBuilder, AnyComponentBuilder, ForumChannel, ForumThreadChannel, GuildForumTag, ForumLayoutType, SortOrderType } from "discord.js";
import { GuildHolder } from "../GuildHolder";
import { Command } from "../interface/Command";
import { hasPerms, replyEphemeral } from "../utils/Util";
import { GuildConfigs } from "../config/GuildConfigs";
import { SetArchiveCategoriesMenu } from "../components/menus/SetArchiveCategoriesMenu";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs";
import { AuthorType } from "../submissions/Author";

export class EndorseCommand implements Command {
    getID(): string {
        return "endorse";
    }

    getBuilder(guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Endorse a submission')
            .setContexts(InteractionContextType.Guild);
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (
            !interaction.inGuild()
        ) {
            replyEphemeral(interaction, 'This command can only be used in a forum channel.')
            return;
        }
        
        // Check if user has endorse role
        if (
            !hasPerms(interaction) &&
            !guildHolder.getConfigManager().getConfig(GuildConfigs.ENDORSE_ROLE_IDS).some(roleId => {
                if (!interaction.inCachedGuild() || !interaction.member) return false;
                return interaction.member.roles?.cache.has(roleId);
            })
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
        // get endorsements
        const endorsements = submission.getConfigManager().getConfig(SubmissionConfigs.ENDORSERS);
        const index = endorsements.findIndex(endorser => endorser.id === interaction.user.id);
        if (index !== -1) {
            // User has already endorsed, remove endorsement
            endorsements.splice(index, 1);
            submission.getConfigManager().setConfig(SubmissionConfigs.ENDORSERS, endorsements);
            interaction.reply({
                content: `<@${interaction.user.id}> Has removed their endorsement.`,
            });
        } else {
            // User has not endorsed, add endorsement
            endorsements.push({ type: AuthorType.Discord, id: interaction.user.id, name: interaction.user.username });
            submission.getConfigManager().setConfig(SubmissionConfigs.ENDORSERS, endorsements);
            interaction.reply({
                content: `<@${interaction.user.id}> Has endorsed this submission.`,
            });
        }

        submission.statusUpdated();
    }

}