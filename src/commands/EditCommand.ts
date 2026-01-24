import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType, ActionRowBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { canEditSubmission, replyEphemeral } from "../utils/Util.js";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs.js";
import { SubmissionStatus } from "../submissions/SubmissionStatus.js";
import { SetAuthorsMenu } from "../components/menus/SetAuthorsMenu.js";
import { SetArchiveCategoryMenu } from "../components/menus/SetArchiveCategoryMenu.js";
import { SetTagsMenu } from "../components/menus/SetTagsMenu.js";
import { SetImagesMenu } from "../components/menus/SetImagesMenu.js";
import { SetAttachmentsMenu } from "../components/menus/SetAttachmentsMenu.js";
import { PublishButton } from "../components/buttons/PublishButton.js";

export class EditCommand implements Command {
    getID(): string {
        return "edit";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Edit a submission. can be used by submitters, editors, and endorsers')
            .setContexts(InteractionContextType.Guild)
            .addSubcommand(subcommand =>
                subcommand
                    .setName('authors')
                    .setDescription('Edit the authors of a submission')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('channel')
                    .setDescription('Edit the archive channel of a submission')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('tags')
                    .setDescription('Edit the tags of a submission')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('images')
                    .setDescription('Edit the images of a submission')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('attachments')
                    .setDescription('Edit the attachments of a submission')
            )
            .addSubcommand(subcommand =>
                subcommand
                    .setName('publish')
                    .setDescription('Send a publish button to the submission channel')
            )

        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (
            !interaction.inGuild() || !interaction.channel
        ) {
            replyEphemeral(interaction, 'This command can only be used in a guild.')
            return;
        }


        const channelId = interaction.channelId;
        const submission = await guildHolder.getSubmissionsManager().getSubmission(channelId);
        if (!submission) {
            replyEphemeral(interaction, 'You can only use this command in a submission channel.');
            return;
        }


        if (
            !canEditSubmission(interaction, submission)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this command!');
            return;
        }



        const subcommand = interaction.options.getSubcommand();
        switch (subcommand) {
            case 'authors': {
                await SetAuthorsMenu.sendAuthorsMenuAndButton(submission, interaction, false);
                break;
            }
            case 'channel': {
                await SetArchiveCategoryMenu.sendArchiveCategorySelector(submission, interaction);
                break;
            }
            case 'tags': {
                SetTagsMenu.sendTagsMenu(submission, interaction);
                break;
            }
            case 'images': {
                SetImagesMenu.sendImagesMenuAndButton(submission, interaction);
                break;
            }
            case 'attachments': {
                SetAttachmentsMenu.sendAttachmentsMenuAndButton(submission, interaction);
                break;
            }
            case 'publish': {
                if (!submission.isPublishable()) {
                    await replyEphemeral(interaction, 'This submission is not ready to be published! Please follow the all steps to complete it.');
                    return;
                }
                const publishButton = new PublishButton().getBuilder(submission.getConfigManager().getConfig(SubmissionConfigs.STATUS) === SubmissionStatus.ACCEPTED);
                await interaction.reply({
                    content: `Congratulations! Your submission is now ready to be published! Click the button below to proceed.`,
                    components: [(new ActionRowBuilder().addComponents(publishButton)) as any]
                });

                break;
            }




            default:
                await replyEphemeral(interaction, 'Invalid subcommand. Please use one of the available subcommands.');
                return;
        }
    }

}