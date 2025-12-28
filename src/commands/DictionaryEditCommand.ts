import { AnyThreadChannel, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { DictionaryEntryStatus } from "../archive/DictionaryManager.js";
import { isEditor, isModerator, replyEphemeral, splitIntoChunks } from "../utils/Util.js";
import { DictionaryEditModal } from "../components/modals/DictionaryEditModal.js";
import { ReferenceType } from "../utils/ReferenceUtils.js";

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
            );
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild() || !interaction.channel || !interaction.channel.isThread()) {
            await replyEphemeral(interaction, 'This command can only be used inside a dictionary thread.');
            return;
        }

        const dictionaryChannelId = guildHolder.getConfigManager().getConfig(GuildConfigs.DICTIONARY_CHANNEL_ID);
        if (!dictionaryChannelId) {
            await replyEphemeral(interaction, 'Dictionary channel is not configured.');
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


        const subcommand = interaction.options.getSubcommand();

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
        await dictionaryManager.saveEntry(entry, true);
        await dictionaryManager.updateStatusMessage(entry, thread);
        await interaction.reply({
            content:
                newStatus === DictionaryEntryStatus.APPROVED ?
                    `<@${interaction.user.id}> has approved this dictionary entry. A request to retag the archives has been sent, and will be completed within 24 hours.` :
                    `<@${interaction.user.id}> has rejected this dictionary entry.`,
            allowedMentions: { parse: [] }
        });
    }
}
