import { ActionRowBuilder, ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { isAdmin, replyEphemeral } from "../utils/Util.js";
import { DiscordJoinMenu } from "../components/menus/DiscordJoinMenu.js";
import { DiscordServersDictionary } from "../archive/DiscordServersDictionary.js";

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
            );

        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild()) {
            await replyEphemeral(interaction, 'This command can only be used in a guild.');
            return;
        }

        const sub = interaction.options.getSubcommand();
        const dictionary = guildHolder.getDiscordServersDictionary();

        if (['add', 'edit', 'remove'].includes(sub) && !isAdmin(interaction)) {
            await replyEphemeral(interaction, 'You do not have permission to manage Discord servers.');
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
                await this.handleList(dictionary, interaction);
                break;
            case 'join':
                await this.handleJoin(dictionary, guildHolder, interaction);
                break;
            default:
                await replyEphemeral(interaction, 'Unknown subcommand.');
        }
    }

    private async handleAdd(dictionary: DiscordServersDictionary, interaction: ChatInputCommandInteraction) {
        const id = interaction.options.getString('id', true);
        const name = interaction.options.getString('name', true);
        const url = interaction.options.getString('url', true);

        await dictionary.addOrEditServer(id, name, url);
        await interaction.reply({
            content: `Saved server **${name}** (${id}).`,
            flags: [MessageFlags.SuppressNotifications],
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

        await dictionary.addOrEditServer(id, name ?? existing.name, url ?? existing.joinURL);
        await interaction.reply({
            content: `Updated server **${name ?? existing.name}** (${id}).`,
            flags: [MessageFlags.SuppressNotifications],
            allowedMentions: { parse: [] },
        });
    }

    private async handleRemove(dictionary: DiscordServersDictionary, interaction: ChatInputCommandInteraction) {
        const id = interaction.options.getString('id', true);
        const removed = await dictionary.removeServer(id);
        if (!removed) {
            await replyEphemeral(interaction, `Server \`${id}\` not found.`);
            return;
        }
        await interaction.reply({
            content: `Removed server \`${id}\`.`,
            flags: [MessageFlags.SuppressNotifications],
            allowedMentions: { parse: [] },
        });
    }

    private async handleList(dictionary: DiscordServersDictionary, interaction: ChatInputCommandInteraction) {
        const servers = await dictionary.getServers();
        if (servers.length === 0) {
            await replyEphemeral(interaction, 'No servers registered yet.');
            return;
        }

        const lines = servers.map(s => `• **${s.name}** (${s.id}) — ${s.joinURL}`);
        const embed = new EmbedBuilder()
            .setTitle('Registered Discord servers')
            .setDescription(lines.join('\n'))
            .setColor(0x5865F2);

        await interaction.reply({
            embeds: [embed],
            flags: [MessageFlags.SuppressNotifications],
            allowedMentions: { parse: [] },
        });
    }

    private async handleJoin(dictionary: DiscordServersDictionary, guildHolder: GuildHolder, interaction: ChatInputCommandInteraction) {
        const servers = await dictionary.getServers();
        if (servers.length === 0) {
            await replyEphemeral(interaction, 'No servers registered to join.');
            return;
        }

        const menu = new DiscordJoinMenu();
        const builder = await menu.getBuilder(guildHolder, servers) as StringSelectMenuBuilder;
        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(builder);

        await interaction.reply({
            content: 'Select a server to view its invite.',
            components: [row],
            ephemeral: true,
        });
    }
}
