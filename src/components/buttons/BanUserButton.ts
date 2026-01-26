import { ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { isModerator, replyEphemeral } from "../../utils/Util.js";

export class BanUserButton implements Button {
    getID(): string {
        return "ban-user-button";
    }

    getBuilder(userId: Snowflake): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`${this.getID()}|${userId}`)
            .setLabel('Ban user')
            .setStyle(ButtonStyle.Danger);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, userId: Snowflake): Promise<void> {
        if (!isModerator(interaction)) {
            await replyEphemeral(interaction, 'You do not have permission to run this action.');
            return;
        }

        try {
            await guildHolder.getGuild().members.ban(userId, { reason: `Manual ban after spam timeout by ${interaction.user.tag}` });
        } catch (error: any) {
            await replyEphemeral(interaction, `Failed to ban user: ${error?.message || 'Unknown error'}`);
            return;
        }

        await interaction.reply({
            content: `Banned <@${userId}>.`,
            flags: MessageFlags.Ephemeral,
        });
    }
}
