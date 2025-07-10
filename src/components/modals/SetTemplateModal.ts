import { ActionRowBuilder, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { isAdmin, replyEphemeral } from "../../utils/Util.js";
import { markdownToSchema, schemaToMarkdownTemplate } from "../../utils/MarkdownUtils.js";
import { GuildConfigs } from "../../config/GuildConfigs.js";
import { TemplateEmbed } from "../../embed/TemplateEmbed.js";

export class SetTemplateModal implements Modal {
    getID(): string {
        return "set-template-modal";
    }

    getBuilder(guildHolder: GuildHolder): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(this.getID())
            .setTitle('Set Post Template');

        const descriptionInput = new TextInputBuilder()
            .setCustomId('input')
            .setLabel('Markdown Template:')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(schemaToMarkdownTemplate(guildHolder.getSchema(), undefined, true))
            .setRequired(true)

        const row1 = new ActionRowBuilder().addComponents(descriptionInput);
        modal.addComponents(row1 as any);
        return modal
    }

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction): Promise<void> {
       
        if (!isAdmin(interaction)) {
            replyEphemeral(interaction, 'You do not have permission to use this!');
            return;
        }

        const templateInput = interaction.fields.getTextInputValue('input');
        let schema;

        try {
            schema = markdownToSchema(templateInput);
        } catch (error: any) {
            replyEphemeral(interaction, `Invalid template: ${error.message}`);
            return;
        }

        guildHolder.getConfigManager().setConfig(GuildConfigs.POST_SCHEMA, schema);

        await interaction.reply({
            content: 'Post template has been set successfully!',
        });

        if (!interaction.channel) {
            return;
        }
        await TemplateEmbed.sendTemplateMessages(interaction.channel, guildHolder)
    }
}