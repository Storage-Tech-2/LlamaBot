import { ChatInputCommandInteraction, ChannelType, ForumChannel, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { SysAdmin } from "../Bot.js";
import { replyEphemeral } from "../utils/Util.js";
import { importACAChannelTask } from "../archive/Tasks.js";

export class DebugCommand implements Command {
    getID(): string {
        return "debug";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
            .setName(this.getID())
            .setDescription('Debug utilities (SysAdmin only)')
            .setContexts(InteractionContextType.Guild)
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

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const setStatus = async (status: string) => {
            await interaction.editReply({ content: status });
        };

        try {
            await setStatus('Starting ACA import...');
            await importACAChannelTask(guildHolder, channel as ForumChannel, setStatus);
            await setStatus('ACA import complete.');
        } catch (error: any) {
            await interaction.editReply({ content: `Import failed: ${error?.message || 'Unknown error'}` });
        }
    }
}
