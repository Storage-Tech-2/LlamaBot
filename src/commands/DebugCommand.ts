import { AttachmentBuilder, ChatInputCommandInteraction, ChannelType, Collection, ForumChannel, GuildMember, InteractionContextType, MessageFlags, SlashCommandBuilder, Snowflake } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { SysAdmin } from "../Bot.js";
import { getAuthorKey, getAuthorName, replyEphemeral } from "../utils/Util.js";
import { deleteACAImportThreadsTask, importACAChannelTask } from "../archive/Tasks.js";
import { SetTemplateModal } from "../components/modals/SetTemplateModal.js";
import { Reference, tagReferencesInSubmissionRecords } from "../utils/ReferenceUtils.js";
import { RevisionEmbed } from "../embed/RevisionEmbed.js";
import { AuthorType, DiscordAuthor } from "../submissions/Author.js";
import { optimizeWorldDownloads } from "../utils/WDLUtils.js";
import got from "got";
import Path from "path";
import os from "os";
import fs from "fs/promises";

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
            )
            .addSubcommand(sub =>
                sub
                    .setName('addthanks')
                    .setDescription('Add thank-you points to a user')
                    .addUserOption(opt =>
                        opt
                            .setName('user')
                            .setDescription('User to receive the points')
                            .setRequired(true)
                    )
                    .addIntegerOption(opt =>
                        opt
                            .setName('amount')
                            .setDescription('Number of points to add')
                            .setMinValue(1)
                    )
                    .addBooleanOption(opt =>
                        opt
                            .setName('add_to_buffer')
                            .setDescription('Also add entries to the 30-day buffer (default: yes)')
                    )
            )
            .addSubcommand(sub =>
                sub
                    .setName('removethanks')
                    .setDescription('Remove thank-you points from a user')
                    .addUserOption(opt =>
                        opt
                            .setName('user')
                            .setDescription('User to remove points from')
                            .setRequired(true)
                    )
                    .addIntegerOption(opt =>
                        opt
                            .setName('amount')
                            .setDescription('Number of points to remove')
                            .setMinValue(1)
                    )
                    .addBooleanOption(opt =>
                        opt
                            .setName('trim_buffer')
                            .setDescription('Also remove entries from the 30-day buffer (default: yes)')
                    )
            )
            .addSubcommand(sub =>
                sub
                    .setName('memberstats')
                    .setDescription('Export member usernames, roles, and join dates as JSON')
            )
            .addSubcommand(sub =>
                sub
                    .setName('listauthors')
                    .setDescription('List archived post authors who are not in the guild')
            )
            .addSubcommand(sub =>
                sub
                    .setName('optimizewdl')
                    .setDescription('Optimize a WDL zip using MCSelector and return the optimized zip')
                    .addAttachmentOption(opt =>
                        opt
                            .setName('zip')
                            .setDescription('Zip containing one or more world downloads')
                            .setRequired(true)
                    )
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
            case 'addthanks':
                await this.handleAddThanks(guildHolder, interaction);
                break;
            case 'removethanks':
                await this.handleRemoveThanks(guildHolder, interaction);
                break;
            case 'memberstats':
                await this.handleMemberStats(guildHolder, interaction);
                break;
            case 'listauthors':
                await this.handleListAuthors(guildHolder, interaction);
                break;
            case 'optimizewdl':
                await this.handleOptimizeWdl(guildHolder, interaction);
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

    private async handleAddThanks(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const targetUser = interaction.options.getUser('user', true);
        const amount = interaction.options.getInteger('amount') ?? 1;
        const addToBuffer = interaction.options.getBoolean('add_to_buffer') ?? true;

        const userData = await guildHolder.getUserManager().getOrCreateUserData(targetUser.id, targetUser.username);
        userData.username = targetUser.username;

        const timestamp = Date.now();
        const channelId = interaction.channel?.id as Snowflake | undefined;
        const messageId = interaction.id as Snowflake;

        userData.thankedCountTotal += amount;

        if (addToBuffer) {
            for (let i = 0; i < amount; i++) {
                userData.thankedBuffer.push({
                    thankedBy: interaction.user.id as Snowflake,
                    timestamp,
                    channelId: channelId ?? guildHolder.getGuild().id as Snowflake,
                    messageId: messageId,
                });
            }
        }

        await guildHolder.getUserManager().saveUserData(userData);
        await guildHolder.checkHelper(userData).catch(() => null);

        await replyEphemeral(interaction, `Added ${amount} thank-you point${amount === 1 ? '' : 's'} to <@${targetUser.id}>${addToBuffer ? ' (buffer updated).' : '.'}`);
    }

    private async handleRemoveThanks(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const targetUser = interaction.options.getUser('user', true);
        const amount = interaction.options.getInteger('amount') ?? 1;
        const trimBuffer = interaction.options.getBoolean('trim_buffer') ?? true;

        const userData = await guildHolder.getUserManager().getUserData(targetUser.id);
        if (!userData) {
            await replyEphemeral(interaction, `No data found for user <@${targetUser.id}>.`);
            return;
        }

        const originalTotal = userData.thankedCountTotal;
        userData.thankedCountTotal = Math.max(0, userData.thankedCountTotal - amount);

        let removedFromBuffer = 0;
        if (trimBuffer && userData.thankedBuffer.length > 0) {
            removedFromBuffer = Math.min(amount, userData.thankedBuffer.length);
            userData.thankedBuffer.splice(-removedFromBuffer, removedFromBuffer);
        }

        await guildHolder.getUserManager().saveUserData(userData);
        await guildHolder.checkHelper(userData).catch(() => null);

        await replyEphemeral(
            interaction,
            `Removed ${amount} thank-you point${amount === 1 ? '' : 's'} from <@${targetUser.id}> (total ${originalTotal} → ${userData.thankedCountTotal})${trimBuffer ? `. Trimmed ${removedFromBuffer} buffer entr${removedFromBuffer === 1 ? 'y' : 'ies'}.` : '.'}`
        );
    }

    private async handleMemberStats(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guild = guildHolder.getGuild();
        let members: Collection<Snowflake, GuildMember>;
        try {
            members = await guild.members.fetch();
        } catch (error: any) {
            await interaction.editReply({ content: `Failed to fetch members: ${error?.message || 'Unknown error'}` });
            return;
        }

        const stats = members.map(member => ({
            username: member.user.username,
            roles: member.roles.cache
                .filter(role => role.id !== guild.id)
                .map(role => role.name),
            joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
        }));

        const buffer = Buffer.from(JSON.stringify(stats, null, 2));
        const attachment = new AttachmentBuilder(buffer, { name: `memberstats-${guild.id}.json` });

        await interaction.editReply({
            content: `Exported ${stats.length} member${stats.length === 1 ? '' : 's'}.`,
            files: [attachment]
        });
    }

    private async handleListAuthors(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guild = guildHolder.getGuild();

        const repositoryManager = guildHolder.getRepositoryManager();
        if (repositoryManager.getChannelReferences().length === 0) {
            await interaction.editReply({ content: 'No archive channels configured.' });
            return;
        }

        type AuthorPosts = { author: DiscordAuthor; posts: Map<string, string> };

        const authorMap = new Map<string, AuthorPosts>();
        const postsWithMissingAuthors = new Set<string>();
        let postsScanned = 0;

        try {
            await repositoryManager.iterateAllEntries(async (entry, entryRef) => {
                const data = entry.getData();
                postsScanned++;

                const postCode = data.code || entryRef.code;
                const postTitle = data.name || postCode;
                const authors = data.authors || [];

                for (const author of authors) {
                    if (author.type === AuthorType.Unknown) {
                        continue;
                    }

                    const key = getAuthorKey(author);
                    const existing = authorMap.get(key);
                    if (existing) {
                        if (!existing.posts.has(postCode)) {
                            existing.posts.set(postCode, postTitle);
                        }
                    } else {
                        const posts = new Map<string, string>();
                        posts.set(postCode, postTitle);
                        authorMap.set(key, { author, posts });
                    }
                }
            });
        } catch (error: any) {
            await interaction.editReply({ content: `Failed to scan archive entries: ${error?.message || 'Unknown error'}` });
            return;
        }

        if (authorMap.size === 0) {
            await interaction.editReply({ content: `No archived post authors found outside of ${guild.name}.` });
            return;
        }

        const report = Array.from(authorMap.values())
            .map(({ author, posts }) => {
                const postList = Array.from(posts.values()).sort((a, b) => a.localeCompare(b));
                return {
                    name: getAuthorName(author),
                    type: author.type,
                    posts: postList
                };
            });

        // sort by name
        report.sort((a, b) => a.name.localeCompare(b.name));

        const escapeCsv = (value: string) => {
            const safe = value.replace(/"/g, '""');
            return `"${safe}"`;
        };
        const csvLines = [
            'Username,Status,Archived Posts',
            ...report.map(item => {
                const posts = item.posts.join(' | ');
                return [
                    escapeCsv(item.name),
                    escapeCsv(item.type),
                    escapeCsv(posts)
                ].join(',');
            })
        ];

        const buffer = Buffer.from(csvLines.join('\n'));
        const attachment = new AttachmentBuilder(buffer, { name: `authors-${guild.id}.csv` });

        const summary = `Found ${report.length} author${report.length === 1 ? '' : 's'} not in ${guild.name} across ${postsWithMissingAuthors.size} post${postsWithMissingAuthors.size === 1 ? '' : 's'} (scanned ${postsScanned} total).`;

        await interaction.editReply({
            content: summary,
            files: [attachment]
        });
    }

    private async handleOptimizeWdl(_guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const attachment = interaction.options.getAttachment('zip', true);
        const nameLower = (attachment.name || '').toLowerCase();
        if (!nameLower.endsWith('.zip')) {
            await replyEphemeral(interaction, 'Please provide a .zip file.');
            return;
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const workRoot = Path.join(os.tmpdir(), 'wdl-debug');
        const session = Path.join(workRoot, `${Date.now().toString(36)}-${attachment.id}`);
        const inputPath = Path.join(session, 'input.zip');

        try {
            await fs.mkdir(session, { recursive: true });

            const res = await got(attachment.url, { responseType: 'buffer' });
            await fs.writeFile(inputPath, res.body);

            const optimizedPath = await optimizeWorldDownloads(inputPath, session);
            const optimizedBuffer = await fs.readFile(optimizedPath);
            const outName = Path.basename(optimizedPath);

            const file = new AttachmentBuilder(optimizedBuffer, { name: outName });
            await interaction.editReply({
                content: `Optimized WDL created (${outName}).`,
                files: [file]
            });
        } catch (error: any) {
            await interaction.editReply({ content: `Optimization failed: ${error?.message || 'Unknown error'}` });
        } finally {
            await fs.rm(session, { recursive: true, force: true }).catch(() => null);
        }
    }
}
