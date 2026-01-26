import { ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags, Snowflake } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { isModerator, replyEphemeral } from "../../utils/Util.js";

export class LiftTimeoutButton implements Button {
    getID(): string {
        return "lift-timeout-button";
    }

    getBuilder(userId: Snowflake): ButtonBuilder {
        return new ButtonBuilder()
            .setCustomId(`${this.getID()}|${userId}`)
            .setLabel('Un-timeout user')
            .setStyle(ButtonStyle.Secondary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, userId: Snowflake): Promise<void> {
        if (!isModerator(interaction)) {
            await replyEphemeral(interaction, 'You do not have permission to run this action.');
            return;
        }

        const member = await guildHolder.getGuild().members.fetch(userId).catch(() => null);
        if (!member) {
            await replyEphemeral(interaction, 'User is not in the guild or could not be fetched.');
            return;
        }

        try {
            await member.timeout(null, `Manual un-timeout by ${interaction.user.tag}`);
        } catch (error: any) {
            await replyEphemeral(interaction, `Failed to remove timeout: ${error?.message || 'Unknown error'}`);
            return;
        }

        await interaction.reply({
            content: `Removed timeout for <@${userId}>.`,
            flags: MessageFlags.Ephemeral,
        });
    }
}
