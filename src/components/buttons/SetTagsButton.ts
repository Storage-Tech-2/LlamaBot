import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { SetTagsMenu } from "../menus/SetTagsMenu";

export class SetTagsButton implements Button {
    getID(): string {
        return "set-tags-button";
    }

    async getBuilder(isSet: boolean): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel(isSet ? "Change Tags" : "Set Tags")
            .setStyle(isSet ? ButtonStyle.Secondary : ButtonStyle.Primary);
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, ...args: string[]): Promise<void> {
        if (!isOwner(interaction) && !hasPerms(interaction)) {
            replyEphemeral(interaction, "You do not have permission to use this!");
            return;
        }

        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, "Submission not found");
            return;
        }

        const isMod = hasPerms(interaction);
        const tagsMenu = new SetTagsMenu();
        const menuBuilder = await tagsMenu.getBuilder(guildHolder, isMod, submission);
        const row = new ActionRowBuilder().addComponents(menuBuilder);

        await interaction.reply({
            content: `<@${interaction.user.id}> Please select tag(s) for the submission`,
            components: [row as any],
            ephemeral: true
        });
    }
}