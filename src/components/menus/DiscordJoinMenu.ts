import { EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { DiscordServerEntry } from "../../dictionary/DiscordServerDictionary.js";
import { Menu } from "../../interface/Menu.js";
import { replyEphemeral } from "../../utils/Util.js";

export class DiscordJoinMenu implements Menu {
    getID(): string {
        return "discords-join-menu";
    }

    async getBuilder(_guildHolder: GuildHolder, servers: DiscordServerEntry[]): Promise<StringSelectMenuBuilder> {
        return new StringSelectMenuBuilder()
            .setCustomId(this.getID())
            .setPlaceholder('Select a Discord server')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                servers.slice(0, 25).map(server => ({
                    label: server.name,
                    description: server.joinURL,
                    value: server.id,
                }))
            );
    }

    async execute(guildHolder: GuildHolder, interaction: StringSelectMenuInteraction): Promise<void> {
        const serverId = interaction.values[0];
        const entry = await guildHolder.getDiscordServersDictionary().getByID(serverId);
        if (!entry) {
            await replyEphemeral(interaction, 'Server not found.');
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(entry.name)
            .setDescription(`[Join server](${entry.joinURL})`)
            .addFields({ name: 'Server ID', value: entry.id })
            .setColor(0x5865F2);

        await interaction.reply({
            embeds: [embed],
            allowedMentions: { parse: [] },
            ephemeral: true,
        });
    }
}
