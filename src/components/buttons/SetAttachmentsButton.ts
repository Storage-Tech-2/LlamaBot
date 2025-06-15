import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder";
import { Button } from "../../interface/Button";
import { hasPerms, isOwner, replyEphemeral } from "../../utils/Util";
import { SetAttachmentsMenu } from "../menus/SetAttachmentsMenu";
import { SetImagesMenu } from "../menus/SetImagesMenu";

export class SetAttachmentsButton implements Button {
    getID(): string {
        return "set-attachments-button";
    }

    async getBuilder(isSet: boolean): Promise<ButtonBuilder> {
        return new ButtonBuilder()
            .setCustomId(this.getID())
            .setLabel(isSet ? "Change Attachments" : "Set Attachments")
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

        const imagesMenu = new SetImagesMenu();
        const imagesMenuBuilder = await imagesMenu.getBuilder(guildHolder, submission);
        const attachmentsMenu = new SetAttachmentsMenu();
        const menuBuilder = await attachmentsMenu.getBuilder(guildHolder, submission);
        const row1 = new ActionRowBuilder().addComponents(imagesMenuBuilder);
        const row2 = new ActionRowBuilder().addComponents(menuBuilder);

        await replyEphemeral(interaction, `<@${interaction.user.id}> Please select image attachments for the submission`,
        {
            components: [row1 as any],
        });


        await replyEphemeral(interaction, `<@${interaction.user.id}> Please select other attachments (Schematics/WDLs) for the submission`,
        {
            components: [row1 as any],
        });


    }
}