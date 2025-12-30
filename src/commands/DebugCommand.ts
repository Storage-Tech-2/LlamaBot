import { ChatInputCommandInteraction, ChannelType, ForumChannel, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { SysAdmin } from "../Bot.js";
import { replyEphemeral } from "../utils/Util.js";
import { deleteACAImportThreadsTask, importACAChannelTask } from "../archive/Tasks.js";
import { SetTemplateModal } from "../components/modals/SetTemplateModal.js";
import { Reference, tagReferencesInSubmissionRecords } from "../utils/ReferenceUtils.js";
import { RevisionEmbed } from "../embed/RevisionEmbed.js";

export class DebugCommand implements Command {
    getID(): string {
        return "debug";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
            .setName(this.getID())
            .setDescription('Debug utilities (SysAdmin only)')
            .setContexts(InteractionContextType.Guild);
        data
            .addSubcommand(sub =>
                sub
                    .setName('importaca')
                    .setDescription('Import an ACA forum channel into submissions')
                    .addChannelOption(opt =>
                        opt
                            .setName('channel')
                            .setDescription('ACA forum channel to import from')
                            .setRequired(true)
                            .addChannelTypes(ChannelType.GuildForum)
                    )
            )
            .addSubcommand(sub =>
                sub
                    .setName('deleteaca')
                    .setDescription('Delete all ACA import threads from the submissions forum')
            )
            .addSubcommand(sub =>
                sub
                    .setName('settemplate')
                    .setDescription('Open the post template modal')
            )
            .addSubcommand(sub =>
                sub
                    .setName('reextract')
                    .setDescription('Force re-run LLM extraction for this submission thread')
            )
            .addSubcommand(sub =>
                sub
                    .setName('updaterevisions')
                    .setDescription('Retag references and refresh revision embeds for all submissions')
            );

        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (interaction.user.id !== SysAdmin) {
            await replyEphemeral(interaction, 'You are not authorized to use this command.');
            return;
        }

        if (!interaction.inGuild()) {
            await replyEphemeral(interaction, 'This command can only be used in a guild.');
            return;
        }

        const sub = interaction.options.getSubcommand();
        switch (sub) {
            case 'importaca':
                await this.handleImportACA(guildHolder, interaction);
                break;
            case 'deleteaca':
                await this.handleDeleteACA(guildHolder, interaction);
                break;
            case 'settemplate':
                await this.handleSetTemplate(guildHolder, interaction);
                break;
            case 'reextract':
                await this.handleReextract(guildHolder, interaction);
                break;
            case 'updaterevisions':
                await this.handleUpdateRevisions(guildHolder, interaction);
                break;
            default:
                await replyEphemeral(interaction, 'Unknown subcommand.');
        }
    }

    private async handleImportACA(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const channel = interaction.options.getChannel('channel', true);
        if (channel.type !== ChannelType.GuildForum) {
            await replyEphemeral(interaction, 'Please select a forum channel to import from.');
            return;
        }


        const feedback = interaction.channel;
        if (!feedback || !feedback.isSendable()) {
            await replyEphemeral(interaction, 'Cannot send feedback messages in this channel.');
            return;
        }


        await interaction.reply({ content: `Starting ACA import for <#${channel.id}>...` });


        const setStatus = async (status: string) => {
            await feedback.send(status);
        };

        try {
            await importACAChannelTask(guildHolder, channel as ForumChannel, setStatus);
            await setStatus('ACA import complete.');
        } catch (error: any) {
            await interaction.editReply({ content: `Import failed: ${error?.message || 'Unknown error'}` });
        }
    }

    private async handleDeleteACA(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const deleted = await deleteACAImportThreadsTask(guildHolder, interaction);
            await interaction.editReply({ content: `Deleted ${deleted} ACA import thread${deleted === 1 ? '' : 's'}.` });
        } catch (error: any) {
            await interaction.editReply({ content: `Delete failed: ${error?.message || 'Unknown error'}` });
        }
    }

    private async handleSetTemplate(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const modal = new SetTemplateModal().getBuilder(guildHolder);
        await interaction.showModal(modal);
    }

    private async handleReextract(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const channel = interaction.channel;
        if (!channel || !channel.isThread()) {
            await replyEphemeral(interaction, 'Run this inside a submission thread.');
            return;
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const submission = await guildHolder.getSubmissionsManager().getSubmission(channel.id);
        if (!submission) {
            await interaction.editReply({ content: 'Submission not found for that thread.' });
            return;
        }

        try {
            const response = await submission.forceLLMExtraction();
            await submission.createRevisionFromExtraction(response, true);
            await interaction.editReply({ content: `Re-extraction complete. New revision created.` });
        } catch (error: any) {
            await interaction.editReply({ content: `Re-extraction failed: ${error?.message || 'Unknown error'}` });
        }
    }

    private async handleUpdateRevisions(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const submissionIds = await guildHolder.getSubmissionsManager().getSubmissionsList();
        let submissionsTouched = 0;
        let revisionsUpdated = 0;
        let errors = 0;

        for (const submissionId of submissionIds) {
            const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId);
            if (!submission) {
                errors++;
                continue;
            }

            const revisionRefs = submission.getRevisionsManager().getRevisionsList();
            if (revisionRefs.length === 0) {
                continue;
            }

            const channel = await submission.getSubmissionChannel(true);
            if (!channel) {
                errors++;
                continue;
            }

            const shouldRearchive = channel.isThread() && channel.archived;
            if (shouldRearchive) {
                await channel.setArchived(false).catch(() => null);
            }

            const retaggedRefs = new Map<string, Reference[]>();
            const revisions = await Promise.all(revisionRefs.map(async ref => {
                const revision = await submission.getRevisionsManager().getRevisionById(ref.id);
                return { ref, revision };
            }));

            revisions.sort((a, b) => {
                const aTime = a.revision?.timestamp || 0;
                const bTime = b.revision?.timestamp || 0;
                return aTime - bTime;
            });

            for (const { ref, revision } of revisions) {
                if (!revision) {
                    errors++;
                    continue;
                }

                if (ref.isCurrent) {

                    const parentRefs = revision.parentRevision
                        ? (retaggedRefs.get(revision.parentRevision) || (await submission.getRevisionsManager().getRevisionById(revision.parentRevision))?.references || [])
                        : [];

                    let newReferences = revision.references || [];
                    try {
                        const previousRefs = [...parentRefs, ...newReferences];
                        newReferences = await tagReferencesInSubmissionRecords(revision.records, previousRefs, guildHolder, submission.getId());
                    } catch (e: any) {
                        console.error(`Failed to retag references for revision ${revision.id}:`, e);
                        errors++;
                        continue;
                    }

                    revision.references = newReferences;
                    retaggedRefs.set(revision.id, newReferences);
                }

                await submission.getRevisionsManager().updateRevision(revision);

                const messages = await Promise.all(revision.messageIds.map(async (messageId) => {
                    return await channel.messages.fetch(messageId);
                })).catch(() => null);
                if (!messages) {
                    errors++;
                    continue;
                }

                try {
                    await RevisionEmbed.editRevisionMessages(messages, submission, revision, ref.isCurrent);
                    revisionsUpdated++;
                } catch (e: any) {
                    console.error(`Failed to update revision messages for ${revision.id}:`, e);
                    errors++;
                }
            }

            submissionsTouched++;

            if (shouldRearchive) {
                await channel.setArchived(true).catch(() => null);
            }
        }

        const errorText = errors > 0 ? ` with ${errors} error${errors === 1 ? '' : 's'} (see logs)` : '';
        await interaction.editReply({ content: `Updated ${revisionsUpdated} revision${revisionsUpdated === 1 ? '' : 's'} across ${submissionsTouched} submission${submissionsTouched === 1 ? '' : 's'}${errorText}.` });
    }
}
