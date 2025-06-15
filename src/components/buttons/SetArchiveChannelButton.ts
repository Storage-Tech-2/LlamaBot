import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { SetArchiveCategoryMenu } from "../menus/SetArchiveCategoryMenu";

export class SetArchiveChannelButton implements Button {
    getID(): string {
        return "set-archive-channel-button";
    }

    async getBuilder(isSet: boolean): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel(isSet ? 'Change Channel' : 'Set Channel')
            .setStyle(isSet ? ButtonStyle.Secondary : ButtonStyle.Primary)
    }

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction, ...args: string[]): Promise<void> {
        if (
            !isOwner(interaction) &&
            !hasPerms(interaction)
        ) {
            replyEphemeral(interaction, 'You do not have permission to use this!')
        }

        const row = new ActionRowBuilder()
            .addComponents(await new SetArchiveCategoryMenu().getBuilder(guildHolder))
        await replyEphemeral(interaction, `<@${interaction.user.id}> Please select an archive category`, {
            components: [row]
        })
    }

}