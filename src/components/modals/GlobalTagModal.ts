import { LabelBuilder, ModalBuilder, ModalSubmitInteraction, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { isAdmin, replyEphemeral } from "../../utils/Util.js";
import { GlobalTag, RepositoryConfigs } from "../../archive/RepositoryConfigs.js";
import { findTagNameConflict, getArchiveForumChannels } from "../../utils/GlobalTagUtils.js";
import { parseColorModOption, parseColorWebOption, parseEmojiOption } from "../../utils/TagValidation.js";

type Mode = 'add' | 'edit';

export class GlobalTagModal implements Modal {
    getID(): string {
        return "global-tag-modal";
    }

    getBuilder(mode: Mode, tag?: GlobalTag): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(`${this.getID()}|${mode}${mode === 'edit' && tag ? `|${tag.name}` : ''}`)
            .setTitle(mode === 'add' ? 'Add Global Tag' : `Edit Tag: ${tag?.name ?? ''}`);

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setPlaceholder(mode === 'add' ? 'Max 20 characters' : 'Blank to keep current name')
            .setStyle(TextInputStyle.Short)
            .setRequired(mode === 'add');
        if (tag?.name) {
            nameInput.setValue(tag.name);
        }

        const emojiInput = new TextInputBuilder()
            .setCustomId('emoji')
            .setPlaceholder(mode === 'add' ? 'e.g., ✅' : 'Blank keep, "clear" remove')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
        if (tag?.emoji) {
            emojiInput.setValue(tag.emoji);
        }

        const moderatedSelect = new StringSelectMenuBuilder()
            .setCustomId('moderated')
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true)
            .setOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Yes, moderated')
                    .setValue('true')
                    .setDescription('Require Manage Threads to use')
                    .setDefault(!!tag?.moderated),
                new StringSelectMenuOptionBuilder()
                    .setLabel('No, unmoderated')
                    .setValue('false')
                    .setDescription('Anyone can use')
                    .setDefault(!tag?.moderated),
            );

        const colorWebInput = new TextInputBuilder()
            .setCustomId('colorweb')
            .setPlaceholder(mode === 'add' ? '#ff8800 (optional)' : '#rrggbb (blank keep, "clear" remove)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
        if (tag?.colorWeb) {
            colorWebInput.setValue(tag.colorWeb);
        }

        const colorModInput = new TextInputBuilder()
            .setCustomId('colormod')
            .setPlaceholder(mode === 'add' ? '0xFF8800 or 16746496 (optional)' : '0xRRGGBB or int (blank keep, "clear" remove)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);
        if (tag?.colorMod !== undefined) {
            colorModInput.setValue(`${tag.colorMod}`);
        }

        modal.addLabelComponents(
            new LabelBuilder().setLabel('Name').setTextInputComponent(nameInput),
            new LabelBuilder().setLabel('Emoji').setTextInputComponent(emojiInput),
            new LabelBuilder().setLabel('Moderated').setStringSelectMenuComponent(moderatedSelect),
            new LabelBuilder().setLabel('Website color').setTextInputComponent(colorWebInput),
            new LabelBuilder().setLabel('Embed color').setTextInputComponent(colorModInput),
        );

        return modal;
    }

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction, mode?: string, originalName?: string): Promise<void> {
        if (!isAdmin(interaction)) {
            replyEphemeral(interaction, 'You do not have permission to manage global tags.');
            return;
        }

        if (mode !== 'add' && mode !== 'edit') {
            replyEphemeral(interaction, 'Unknown tag action. Please try again.');
            return;
        }

        const configManager = guildHolder.getRepositoryManager().getConfigManager();
        const tags = configManager.getConfig(RepositoryConfigs.GLOBAL_TAGS);
        let currentTag: GlobalTag | undefined;
        let tagIndex = -1;
        if (mode === 'edit') {
            if (!originalName) {
                replyEphemeral(interaction, 'Missing tag reference. Please start the edit again.');
                return;
            }
            tagIndex = tags.findIndex(tag => tag.name === originalName);
            if (tagIndex === -1) {
                replyEphemeral(interaction, 'The selected tag no longer exists.');
                return;
            }
            currentTag = tags[tagIndex];
        }

        const nameRaw = interaction.fields.getTextInputValue('name').trim();
        const emojiRaw = interaction.fields.getTextInputValue('emoji').trim();
        const colorWebRaw = interaction.fields.getTextInputValue('colorweb').trim();
        const colorModRaw = interaction.fields.getTextInputValue('colormod').trim();
        const moderatedSelect = interaction.fields.getStringSelectValues('moderated')[0];
        if (!moderatedSelect) {
            await replyEphemeral(interaction, 'Please choose whether the tag is moderated.');
            return;
        }

        const newName = (mode === 'edit' ? (nameRaw.length ? nameRaw : currentTag!.name) : nameRaw).trim();
        if (!newName.length) {
            await replyEphemeral(interaction, 'Tag name cannot be empty.');
            return;
        }
        if (newName.length > 20) {
            await replyEphemeral(interaction, 'Tag names must be 20 characters or fewer.');
            return;
        }

        const emojiResult = parseEmojiOption(emojiRaw || null, mode === 'edit');
        if (emojiResult.error) {
            await replyEphemeral(interaction, emojiResult.error);
            return;
        }

        const colorWebResult = parseColorWebOption(colorWebRaw || null, mode === 'edit');
        if (colorWebResult.error) {
            await replyEphemeral(interaction, colorWebResult.error);
            return;
        }

        const colorModResult = parseColorModOption(colorModRaw || null, mode === 'edit');
        if (colorModResult.error) {
            await replyEphemeral(interaction, colorModResult.error);
            return;
        }

        const moderated = moderatedSelect === 'true';

        if (mode === 'add') {
            if (tags.some(tag => tag.name.toLowerCase() === newName.toLowerCase())) {
                await replyEphemeral(interaction, `A global tag named "${newName}" already exists.`);
                return;
            }

            const newTag: GlobalTag = { name: newName, moderated };
            if (emojiResult.provided && emojiResult.value) newTag.emoji = emojiResult.value;
            if (colorWebResult.provided && colorWebResult.value) newTag.colorWeb = colorWebResult.value;
            if (colorModResult.provided && colorModResult.value !== undefined) newTag.colorMod = colorModResult.value ?? undefined;

            const newGlobalTags = [...tags, newTag];
            configManager.setConfig(RepositoryConfigs.GLOBAL_TAGS, newGlobalTags);
            try {
                await guildHolder.getRepositoryManager().configChanged();
            } catch (error: any) {
                await replyEphemeral(interaction, `Failed to save global tag: ${error?.message || error}`);
                return;
            }

            await interaction.deferReply();
            await guildHolder.getRepositoryManager().applyGlobalTagChanges(newGlobalTags);

            await interaction.editReply({
                content: `Added global tag "${newTag.name}"${newTag.emoji ? ` (${newTag.emoji})` : ''}.`,
            });
            return;
        }

        // edit flow
        if (tags.some((tag, idx) => idx !== tagIndex && tag.name.toLowerCase() === newName.toLowerCase())) {
            await replyEphemeral(interaction, `Another global tag named "${newName}" already exists.`);
            return;
        }

        const channels = await getArchiveForumChannels(guildHolder);
        const conflict = findTagNameConflict(channels, currentTag!.name, newName);
        if (conflict) {
            await replyEphemeral(interaction, `A tag named "${newName}" already exists in ${conflict.toString()}. Rename it first or choose a different name.`);
            return;
        }

        const updatedTag: GlobalTag = {
            ...currentTag!,
            name: newName,
            moderated,
        };

        if (emojiResult.provided) {
            updatedTag.emoji = emojiResult.value ?? undefined;
        }
        if (colorWebResult.provided) {
            if (colorWebResult.value === null) {
                delete updatedTag.colorWeb;
            } else {
                updatedTag.colorWeb = colorWebResult.value;
            }
        }
        if (colorModResult.provided) {
            if (colorModResult.value === null) {
                delete updatedTag.colorMod;
            } else {
                updatedTag.colorMod = colorModResult.value;
            }
        }

        const updatedTags = [...tags];
        updatedTags[tagIndex] = updatedTag;

        configManager.setConfig(RepositoryConfigs.GLOBAL_TAGS, updatedTags);
        try {
            await guildHolder.getRepositoryManager().configChanged();
        } catch (error: any) {
            await replyEphemeral(interaction, `Failed to save tag changes: ${error?.message || error}`);
            return;
        }

        await ensureDeferred();
        await guildHolder.getRepositoryManager().applyGlobalTagChanges(updatedTags, currentTag!.name);

        await interaction.editReply({
            content: `Updated global tag "${currentTag!.name}" to "${updatedTag.name}".`,
        });
    }
}
