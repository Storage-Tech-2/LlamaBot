import { AnyThreadChannel, ChannelType, ChatInputCommandInteraction, ForumChannel, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { DictionaryEntryStatus } from "../archive/DictionaryManager.js";
import { isEditor, isModerator, replyEphemeral, splitIntoChunks } from "../utils/Util.js";
import { DictionaryEditModal } from "../components/modals/DictionaryEditModal.js";

export class DictionaryEditCommand implements Command {
    getID(): string {
        return "dictionary";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder();
        data
            .setName(this.getID())
            .setDescription('Edit or review a dictionary entry')
            .setContexts(InteractionContextType.Guild)
            .addSubcommand(sub =>
                sub
                    .setName('edit')
                    .setDescription('Edit dictionary terms/definition via modal')
            )
            .addSubcommand(sub =>
                sub
                    .setName('approve')
                    .setDescription('Approve this dictionary entry')
            )
            .addSubcommand(sub =>
                sub
                    .setName('reject')
                    .setDescription('Reject this dictionary entry')
            )
            .addSubcommand(sub =>
                sub
                    .setName('references')
                    .setDescription('Show the archive entries that reference this dictionary entry')
            )
            .addSubcommand(sub =>
                sub
                    .setName('closeposts')
                    .setDescription('Close all open dictionary threads')
            );
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild()) {
            await replyEphemeral(interaction, 'This command can only be used in a guild.');
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        const dictionaryChannelId = guildHolder.getConfigManager().getConfig(GuildConfigs.DICTIONARY_CHANNEL_ID);
        if (!dictionaryChannelId) {
            await replyEphemeral(interaction, 'Dictionary channel is not configured.');
            return;
        }

        if (subcommand === 'closeposts') {
            if (!isEditor(interaction, guildHolder) && !isModerator(interaction)) {
                await replyEphemeral(interaction, 'You do not have permission to use this command.');
                return;
            }

            const dictionaryChannel = await guildHolder.getGuild().channels.fetch(dictionaryChannelId).catch(() => null) as ForumChannel | null;
            if (!dictionaryChannel || dictionaryChannel.type !== ChannelType.GuildForum) {
                await replyEphemeral(interaction, 'Dictionary channel is not configured as a forum.');
                return;
            }

            await interaction.reply('Starting to close all dictionary threads. This may take a while depending on the number of open threads. You will be notified when it is complete.');

            const dictionaryManager = guildHolder.getDictionaryManager();
            const threads = await dictionaryChannel.threads.fetchActive();
            for (const thread of threads.threads.values()) {
                const entry = await dictionaryManager.getEntry(thread.id);
                if (entry && entry.status === DictionaryEntryStatus.PENDING) {
                    continue;
                }

                try {
                    await thread.setArchived(true, 'Closing dictionary thread via closeposts command');
                } catch (error) {
                    console.error(`Error closing dictionary thread ${thread.name} (${thread.id}):`, error);
                }
            }

            await interaction.followUp(`<@${interaction.user.id}> Closing all dictionary threads complete!`);
            return;
        }

        if (!interaction.channel || !interaction.channel.isThread()) {
            await replyEphemeral(interaction, 'This command can only be used inside a dictionary thread.');
            return;
        }

        if (interaction.channel.parentId !== dictionaryChannelId) {
            await replyEphemeral(interaction, 'This command can only be used inside a dictionary thread.');
            return;
        }

        if (!isEditor(interaction, guildHolder) && !isModerator(interaction)) {
            await replyEphemeral(interaction, 'You do not have permission to use this command.');
            return;
        }
        const dictionaryManager = guildHolder.getDictionaryManager();
        const thread = interaction.channel as AnyThreadChannel;
        const entry = await dictionaryManager.ensureEntryForThread(thread);
        if (!entry) {
            await replyEphemeral(interaction, 'Could not load a dictionary entry for this thread.');
            return;
        }


        if (subcommand === 'references') {

            const matches: { name: string; url: string }[] = [];
            for (const code of entry.referencedBy) {
                const archiveEntry = await guildHolder.getRepositoryManager().findEntryBySubmissionCode(code);
                if (!archiveEntry) continue;
                const data = archiveEntry.entry.getData();
                matches.push({
                    name: data.name,
                    url: data.post?.threadURL || ''
                });
            }

            if (matches.length === 0) {
                await replyEphemeral(interaction, 'No archive entries reference this dictionary entry.');
                return;
            }
            
            let response = `Archive entries referencing this dictionary entry:\n`;
            for (const match of matches) {
                response += `- [${match.name}](${match.url})\n`;
            }

            const split = splitIntoChunks(response, 2000);
            let first = true;
            for (const chunk of split) {
                if (first) {
                    await interaction.reply({ 
                        content: chunk,
                        allowedMentions: { parse: [] }
                    });
                    first = false;
                    continue;
                }

                await interaction.channel.send({ 
                    content: chunk,
                    allowedMentions: { parse: [] }
                });
            }
            return;
        } else if (subcommand === 'edit') {
            const modal = await new DictionaryEditModal().getBuilder(entry);
            await interaction.showModal(modal);
            return;
        }

        const newStatus = subcommand === 'approve' ? DictionaryEntryStatus.APPROVED : DictionaryEntryStatus.REJECTED;
        entry.status = newStatus;
        entry.updatedAt = Date.now();

        await interaction.deferReply();

        await dictionaryManager.saveEntry(entry, true);
        await dictionaryManager.updateStatusMessage(entry, thread);
        await interaction.editReply({
            content:
                newStatus === DictionaryEntryStatus.APPROVED ?
                    `<@${interaction.user.id}> has approved this dictionary entry.` :
                    `<@${interaction.user.id}> has rejected this dictionary entry.`,
            allowedMentions: { parse: [] }
        });
    }
}
