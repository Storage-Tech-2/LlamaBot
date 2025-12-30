import { EmbedBuilder, LabelBuilder, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { GuildHolder } from "../../GuildHolder.js";
import { Modal } from "../../interface/Modal.js";
import { replyEphemeral, splitIntoChunks } from "../../utils/Util.js";
import { RuleMatcher } from "../../utils/RuleMatcher.js";

export class SetScriptModal implements Modal {
    getID(): string {
        return "set-script-modal";
    }

    getBuilder(existingCode: string): ModalBuilder {
        const modal = new ModalBuilder()
            .setCustomId(this.getID())
            .setTitle('Edit Script')

        const descriptionInput = new TextInputBuilder()
            .setCustomId('input')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('JavaScript code for the script.')

        const descriptionLabel = new LabelBuilder()
            .setLabel('Script Code:')
            .setTextInputComponent(descriptionInput);

        if (existingCode) {
            descriptionInput.setValue(existingCode);
        }

        modal.addLabelComponents(descriptionLabel);
        return modal
    }

    async execute(guildHolder: GuildHolder, interaction: ModalSubmitInteraction): Promise<void> {
        if (!interaction.inGuild()) {
            replyEphemeral(interaction, 'This command can only be used in a guild channel')
            return
        }

        const channelId = interaction.channelId
        if (!channelId) {
            replyEphemeral(interaction, 'Channel ID not found')
            return
        }

        const scriptCode = (interaction.fields.getTextInputValue('input') || '').trim();

        const channelSubscriptionManager = guildHolder.getChannelSubscriptionManager();
        const existingSubscription = await channelSubscriptionManager.getSubscriptions();
        if (!existingSubscription[channelId]) {
            existingSubscription[channelId] = {
                code: "",
                subscribedUsers: []
            };
        }

        existingSubscription[channelId].code = scriptCode;

        if (!scriptCode && existingSubscription[channelId].subscribedUsers.length === 0) {
            delete existingSubscription[channelId];
        }

        await channelSubscriptionManager.saveSubscriptions(existingSubscription);

        if (scriptCode) {
            const embed = new EmbedBuilder()
                .setTitle('Filter Script Set')
                .setDescription('Matching submissions will be announced automatically: ```javascript\n' + scriptCode + '\n```')
                .setColor(0x00FF00);
            await interaction.reply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setTitle('Filter Script Removed')
                .setDescription('The filter script has been removed. No further submissions will be matched.')
                .setColor(0xFFFF00);
            await interaction.reply({ embeds: [embed] });

            return;
        }

        if (scriptCode.length === 0) {
            return;
        }

        const submissions = await guildHolder.getSubmissionsManager().getSubmissionsList();

        const runningMessage = await interaction.channel?.send(`Running script on ${submissions.length} existing submissions. This may take a while.`);
        let matchCount = 0;
        let errored = false;
        for (const submissionId of submissions) {
            const submission = await guildHolder.getSubmissionsManager().getSubmission(submissionId);
            if (!submission) {
                continue;
            }

            try {
                const isMatch = await RuleMatcher.isMatch(submission, scriptCode);
                if (isMatch) {
                    matchCount++;
                }
            } catch (e: any) {
                const split = splitIntoChunks(e.message, 3800);
                for (const chunk of split) {
                    const embed = new EmbedBuilder()
                        .setTitle('Script Error')
                        .setDescription(`An error occurred while running the script on submission <#${submissionId}>:\n${chunk}`)
                        .setColor(0xFF0000);
                    await interaction.channel?.send({ embeds: [embed] });
                }
                errored = true;
                break;
            }
        }

        if (!errored) {
            await runningMessage?.edit(`Script run complete. ${matchCount} out of ${submissions.length} submissions matched.`);
        } else {
            await runningMessage?.edit(`Script run aborted due to errors.`);
        }
    }
}