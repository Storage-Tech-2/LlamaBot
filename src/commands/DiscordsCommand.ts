import { ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { isAdmin, replyEphemeral, splitIntoChunks } from "../utils/Util.js";
import { DiscordServersDictionary } from "../archive/DiscordServersDictionary.js";
import { SysAdmin } from "../Bot.js";

export class DiscordsCommand implements Command {
    getID(): string {
        return "discords";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
            .setName(this.getID())
            .setDescription('Manage the Discord servers dictionary')
            .setContexts(InteractionContextType.Guild);

        data
            .addSubcommand(sub =>
                sub
                    .setName('add')
                    .setDescription('Add a Discord server to the dictionary')
                    .addStringOption(opt =>
                        opt
                            .setName('id')
                            .setDescription('Server ID')
                            .setRequired(true)
                    )
                    .addStringOption(opt =>
                        opt
                            .setName('name')
                            .setDescription('Server name')
                            .setRequired(true)
                    )
                    .addStringOption(opt =>
                        opt
                            .setName('url')
                            .setDescription('Invite or join URL')
                            .setRequired(true)
                    )
                    .addBooleanOption(opt =>
                        opt
                            .setName('global')
                            .setDescription('Use the global dictionary (SysAdmin only)')
                            .setRequired(false)
                    )
            )
            .addSubcommand(sub =>
                sub
                    .setName('edit')
                    .setDescription('Edit a Discord server entry')
                    .addStringOption(opt =>
                        opt
                            .setName('id')
                            .setDescription('Server ID')
                            .setRequired(true)
                    )
                    .addStringOption(opt =>
                        opt
                            .setName('name')
                            .setDescription('Server name')
                            .setRequired(false)
                    )
                    .addStringOption(opt =>
                        opt
                            .setName('url')
                            .setDescription('Invite or join URL')
                            .setRequired(false)
                    )
                    .addBooleanOption(opt =>
                        opt
                            .setName('global')
                            .setDescription('Use the global dictionary (SysAdmin only)')
                            .setRequired(false)
                    )
            )
            .addSubcommand(sub =>
                sub
                    .setName('remove')
                    .setDescription('Remove a Discord server from the dictionary')
                    .addStringOption(opt =>
                        opt
                            .setName('id')
                            .setDescription('Server ID')
                            .setRequired(true)
                    )
                    .addBooleanOption(opt =>
                        opt
                            .setName('global')
                            .setDescription('Use the global dictionary (SysAdmin only)')
                            .setRequired(false)
                    )
            )
            .addSubcommand(sub =>
                sub
                    .setName('list')
                    .setDescription('List all registered Discord servers')
            )
            .addSubcommand(sub =>
                sub
                    .setName('join')
                    .setDescription('Pick a server to show its join info')
            ); // kept for backward compatibility; handled separately

        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild()) {
            await replyEphemeral(interaction, 'This command can only be used in a guild.');
            return;
        }

        const sub = interaction.options.getSubcommand();
        const requiresManage = ['add', 'edit', 'remove'].includes(sub);
        const isSysAdmin = interaction.user.id === SysAdmin;
        const useGlobal = requiresManage ? (interaction.options.getBoolean('global') ?? false) : false;
        const dictionary = useGlobal
            ? guildHolder.getBot().getGlobalDiscordServersDictionary()
            : guildHolder.getDiscordServersDictionary();

        if (requiresManage && !isSysAdmin && !isAdmin(interaction)) {
            await replyEphemeral(interaction, 'You do not have permission to manage Discord servers.');
            return;
        }

        if (useGlobal && !isSysAdmin) {
            await replyEphemeral(interaction, 'Global dictionary can only be used by the SysAdmin.');
            return;
        }

        switch (sub) {
            case 'add':
                await this.handleAdd(dictionary, interaction);
                break;
            case 'edit':
                await this.handleEdit(dictionary, interaction);
                break;
            case 'remove':
                await this.handleRemove(dictionary, interaction);
                break;
            case 'list':
                await this.handleList(dictionary, guildHolder, interaction);
                break;
            default:
                await replyEphemeral(interaction, 'Unknown subcommand.');
        }
    }

    private async handleAdd(dictionary: DiscordServersDictionary, interaction: ChatInputCommandInteraction) {
        const id = interaction.options.getString('id', true);
        const name = interaction.options.getString('name', true);
        const url = interaction.options.getString('url', true);

        await interaction.deferReply();
        await dictionary.addOrEditServer(id, name, url);
        await interaction.editReply({
            content: `Saved server **${name}** (${id}).`,
            allowedMentions: { parse: [] },
        });
    }

    private async handleEdit(dictionary: DiscordServersDictionary, interaction: ChatInputCommandInteraction) {
        const id = interaction.options.getString('id', true);
        const name = interaction.options.getString('name') || undefined;
        const url = interaction.options.getString('url') || undefined;

        const existing = await dictionary.getByID(id);
        if (!existing) {
            await replyEphemeral(interaction, `Server \`${id}\` not found.`);
            return;
        }

        await interaction.deferReply();
        await dictionary.addOrEditServer(id, name ?? existing.name, url ?? existing.joinURL);
        await interaction.editReply({
            content: `Updated server **${name ?? existing.name}** (${id}).`,
            allowedMentions: { parse: [] },
        });
    }

    private async handleRemove(dictionary: DiscordServersDictionary, interaction: ChatInputCommandInteraction) {
        const id = interaction.options.getString('id', true);
        await interaction.deferReply();
        const removed = await dictionary.removeServer(id);
        if (!removed) {
            await interaction.editReply({
                content: `Server \`${id}\` not found.`,
                allowedMentions: { parse: [] },
            });
            return;
        }
        await interaction.editReply({
            content: `Removed server \`${id}\`.`,
            allowedMentions: { parse: [] },
        });
    }

    private async handleList(dictionary: DiscordServersDictionary, guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const localServers = await dictionary.getServers();
        const globalServers = await guildHolder.getBot().getGlobalDiscordServersDictionary().getServers();
        const localIds = new Set(localServers.map(s => s.id));
        const combined = [
            ...localServers.map(s => ({ ...s, isGlobal: false })),
            ...globalServers
                .filter(s => !localIds.has(s.id))
                .map(s => ({ ...s, isGlobal: true })),
        ];

        if (combined.length === 0) {
            await replyEphemeral(interaction, 'No servers registered yet.');
            return;
        }

        combined.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        const lines = combined.map(s => `- **${s.name}**${s.isGlobal ? ' [global]' : ''} (${s.id})\n    - ${s.joinURL}`);

        const textSplit = splitIntoChunks(lines.join('\n'), 4000);


        for (let i = 0; i < textSplit.length; i++) {
            const isFirst = i === 0;
            
            const embed = new EmbedBuilder()
                .setTitle('Registered Discord servers')
                .setDescription(textSplit[i])
                .setColor(0x5865F2)
                .setFooter({ text: `Page ${i + 1} of ${textSplit.length}` });

            if (isFirst) {
                await interaction.reply({
                    embeds: [embed],
                    flags: [MessageFlags.SuppressNotifications],
                    allowedMentions: { parse: [] },
                });
            } else {
                await interaction.followUp({
                    embeds: [embed],
                    flags: [MessageFlags.SuppressNotifications],
                    allowedMentions: { parse: [] },
                });
            }
        }
    }

}
