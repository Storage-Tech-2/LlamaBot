import { AutocompleteInteraction, ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "../interface/Command.js";
import { GuildHolder } from "../GuildHolder.js";
import { replyEphemeral } from "../utils/Util.js";

export class JoinDiscordCommand implements Command {
    getID(): string {
        return "join";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
            .setName(this.getID())
            .setDescription("Show join info for a registered Discord server")
            .setContexts(InteractionContextType.Guild);

        data.addStringOption(opt =>
            opt
                .setName("server")
                .setDescription("Server to join")
                .setRequired(true)
                .setAutocomplete(true)
        );

        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (!interaction.inGuild()) {
            await replyEphemeral(interaction, "This command can only be used in a guild.");
            return;
        }

        const dictionary = guildHolder.getDiscordServersDictionary();
        const servers = await dictionary.getCachedServersWithFallback();
        if (servers.length === 0) {
            await replyEphemeral(interaction, "No servers registered to join.");
            return;
        }

        const serverId = interaction.options.getString("server", true);
        const server = servers.find(s => s.id === serverId);
        if (!server) {
            await replyEphemeral(interaction, "Server not found. Please pick from the suggestions.");
            return;
        }

        await interaction.reply({
            content: `**${server.name}** invite:\n${server.joinURL}`,
            allowedMentions: { parse: [] },
        });
    }

    async autocomplete(guildHolder: GuildHolder, interaction: AutocompleteInteraction): Promise<void> {
        const dictionary = guildHolder.getDiscordServersDictionary();
        const servers = await dictionary.getCachedServersWithFallback();
        const query = (interaction.options.getFocused() || "").toLowerCase();

        const seen = new Set<string>();
        const choices = servers
            .filter(server => {
                if (seen.has(server.id)) return false;
                seen.add(server.id);
                if (!query) return true;
                return server.name.toLowerCase().includes(query) || server.id.includes(query);
            })
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
            .slice(0, 25)
            .map(server => ({
                name: `${server.name} (${server.id})`.slice(0, 100),
                value: server.id,
            }));

        await interaction.respond(choices);
    }
}
