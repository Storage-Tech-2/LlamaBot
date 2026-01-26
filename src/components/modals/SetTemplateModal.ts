import { LabelBuilder, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { isAdmin, replyEphemeral } from "../../utils/Util.js";
import { markdownToSchema, schemaToMarkdownTemplate } from "../../utils/MarkdownUtils.js";
import { TemplateEmbed } from "../../embed/TemplateEmbed.js";
import { RepositoryConfigs } from "../../archive/RepositoryConfigs.js";

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
            .setStyle(TextInputStyle.Paragraph)
            .setValue(schemaToMarkdownTemplate(guildHolder.getSchema(), guildHolder.getSchemaStyles(), undefined, undefined, true))
            .setRequired(true)

        const descriptionLabel = new LabelBuilder()
            .setLabel('Markdown Template:')
            .setTextInputComponent(descriptionInput);

        modal.addLabelComponents(descriptionLabel);
        return modal
    }

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction): Promise<void> {
       
        if (!isAdmin(interaction)) {
            replyEphemeral(interaction, 'You do not have permission to use this!');
            return;
        }

        const templateInput = interaction.fields.getTextInputValue('input');
        let schema, style;

        try {
            const result = markdownToSchema(templateInput);
            schema = result.schema;
            style = result.style;
        } catch (error: any) {
            replyEphemeral(interaction, `Invalid template: ${error.message}`);
            return;
        }

        guildHolder.getRepositoryManager().getConfigManager().setConfig(RepositoryConfigs.POST_SCHEMA, schema);
        guildHolder.getRepositoryManager().getConfigManager().setConfig(RepositoryConfigs.POST_STYLE, style);

        await guildHolder.getRepositoryManager().configChanged();
        
        await interaction.reply({
            content: 'Post template has been set successfully!',
        });

        if (!interaction.channel) {
            return;
        }
        await TemplateEmbed.sendTemplateMessages(interaction.channel, guildHolder)
    }
}