import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Button } from "../../interface/Button.js";
import { canEditSubmission, replyEphemeral } from "../../utils/Util.js";
import { SetAttachmentsMenu } from "../menus/SetAttachmentsMenu.js";
import { SetImagesMenu } from "../menus/SetImagesMenu.js";
import { SubmissionConfigs } from "../../submissions/SubmissionConfigs.js";

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

    async execute(guildHolder: GuildHolder, interaction: ButtonInteraction): Promise<void> {
        const submission = await guildHolder.getSubmissionsManager().getSubmission(interaction.channelId);
        if (!submission) {
            replyEphemeral(interaction, "Submission not found");
            return;
        }

        if (!canEditSubmission(interaction, submission)) {
            replyEphemeral(interaction, "You do not have permission to use this!");
            return;
        }


        const imagesMenu = new SetImagesMenu();
        const attachmentsMenu = new SetAttachmentsMenu();

        const shouldAlsoAskAttachments = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) !== null;
        const imagesMenuBuilder = await imagesMenu.getBuilderOrNull(submission);
        const menuBuilder = shouldAlsoAskAttachments ? await attachmentsMenu.getBuilderOrNull(guildHolder, submission) : null;

        if (imagesMenuBuilder) {
            const row1 = new ActionRowBuilder().addComponents(imagesMenuBuilder);
            await replyEphemeral(interaction, `Please select image attachments for the submission`,
                {
                    components: [row1 as any],
                });
        } else if (menuBuilder || !shouldAlsoAskAttachments) {
            const row = new ActionRowBuilder()
                .addComponents(await new SetAttachmentsButton().getBuilder(false));
            await replyEphemeral(interaction, `No image attachments found! Try uploading images first and then use this button again.`,{
                components: [row as any]
            });
        }

        if (menuBuilder) {
            const row2 = new ActionRowBuilder().addComponents(menuBuilder);
            await replyEphemeral(interaction, `Please select other attachments (Schematics/WDLs) for the submission`,
                {
                    components: [row2 as any],
                });
        } else if (shouldAlsoAskAttachments) {
            const row = new ActionRowBuilder()
                .addComponents(await new SetAttachmentsButton().getBuilder(false));
            await replyEphemeral(interaction, `No attachments found! Try uploading files first and then use this button again.`, {
                components: [row as any]
            });
        }
    }
}