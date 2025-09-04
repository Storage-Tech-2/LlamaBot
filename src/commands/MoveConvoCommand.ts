import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType, MessageFlags, Message, Snowflake, Collection, ActionRowBuilder } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { replyEphemeral, splitIntoChunks } from "../utils/Util.js";
import { getMoveConvoData, saveMoveConvoData } from "../support/MoveConvoTool.js";
import { MoveConvoConfirmButton } from "../components/buttons/MoveConvoConfirmButton.js";
import { MoveConvoCancelButton } from "../components/buttons/MoveConvoCancelButton.js";

export class MoveConvoCommand implements Command {
    getID(): string {
        return "moveconvo";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Moves the conversation to a new thread')
            .setContexts(InteractionContextType.Guild);
        data.addChannelOption(option =>
            option.setName('destination')
                .setDescription('The destination channel')
                .setRequired(true)
        );
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (
            !interaction.inGuild()
        ) {
            await replyEphemeral(interaction, 'This command can only be used in a guild channel.')
            return;
        }

        // check perms
        if (!interaction.memberPermissions.has('ManageMessages')) {
            await replyEphemeral(interaction, 'You do not have permission to use this command!');
            return;
        }

        const data = getMoveConvoData(guildHolder.getBot(), interaction.user.id, interaction.channelId);
        if (!data) {
            await replyEphemeral(interaction, 'You have not marked any conversation to move. Please use the context menu commands to mark the start and end of the conversation first.');
            return;
        }

        if (!data.startMessageId) {
            await replyEphemeral(interaction, 'You have not marked a start message. Please use the context menu command "Mark Convo Start" on a message to mark the start of the conversation.');
            return;
        }

        if (!data.endMessageId) {
            await replyEphemeral(interaction, 'You have not marked an end message. Please use the context menu command "Mark Convo End" on a message to mark the end of the conversation.');
            return;
        }

        const destinationChannelId = interaction.options.getChannel('destination', true).id;
        const destinationChannel = await guildHolder.getGuild().channels.fetch(destinationChannelId).catch(() => null);
        if (!destinationChannel || !destinationChannel.isSendable() || destinationChannel.isVoiceBased()) {
            await replyEphemeral(interaction, 'The destination channel must be a text channel or thread.');
            return;
        }

        const currentChannel = await guildHolder.getGuild().channels.fetch(interaction.channelId).catch(() => null);

        if (!currentChannel || !currentChannel.isTextBased() || currentChannel.isVoiceBased()) {
            await replyEphemeral(interaction, 'This command can only be used in a text channel or thread.');
            return;
        }

        // user must have manage messages permission in both channels
        const member = await guildHolder.getGuild().members.fetch(interaction.user.id).catch(() => null);
        if (!member) {
            await replyEphemeral(interaction, 'Could not fetch your member data.');
            return;
        }

        if (!currentChannel.permissionsFor(member).has('ManageMessages')) {
            await replyEphemeral(interaction, 'You need the Manage Messages permission in the current channel to use this command.');
            return;
        }

        if (!destinationChannel.permissionsFor(member).has('ManageMessages')) {
            await replyEphemeral(interaction, 'You need the Manage Messages permission in the destination channel to use this command.');
            return;
        }


        // start message must be after or same as end message
        const startMessage = await currentChannel.messages.fetch(data.startMessageId).catch(() => null);
        const endMessage = await currentChannel.messages.fetch(data.endMessageId).catch(() => null);
        if (!startMessage || !endMessage) {
            await replyEphemeral(interaction, 'Could not find the start or end message. They may have been deleted.');
            return;
        }

        if (startMessage.createdTimestamp > endMessage.createdTimestamp) {
            await replyEphemeral(interaction, 'The start message must be before or the same as the end message.');
            return;
        }

        const origMessage = await interaction.reply({
            content: `Copying over messages...`,
            flags: [MessageFlags.SuppressNotifications]
        });

        // Fetch messages between start and end, inclusive
        let messagesToMove: Message[] = [];
        let lastId: string | undefined = undefined;
        l0: while (true) {
            const fetched: Collection<Snowflake, Message> = await currentChannel.messages.fetch({
                limit: 100,
                before: lastId,
            });

            if (fetched.size === 0) {
                break l0;
            }

            for (const msg of fetched.values()) {
                if (msg.createdTimestamp > endMessage.createdTimestamp) {
                    continue;
                }
                if (msg.createdTimestamp < startMessage.createdTimestamp) {
                    break l0;
                }
                if (msg.createdTimestamp <= endMessage.createdTimestamp) {
                    messagesToMove.push(msg);
                }
            }
            lastId = fetched.last()?.id;
        }

        // oldest first
        messagesToMove.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        // Remove bot messages
        const botId = guildHolder.getBot().client.user?.id;
        messagesToMove = messagesToMove.filter(m => m.author.id !== botId);

        const webhook = await (destinationChannel.isThread() ? destinationChannel.parent : destinationChannel)?.createWebhook({
            name: 'LlamaBot MoveConvo Tool',
        });

        if (!webhook) {
            await origMessage.edit({
                content: `Failed to create webhook in destination channel. Please ensure I have the Manage Webhooks permission there.`,
            });
            return;
        }

        const originalMessageIds: Snowflake[] = messagesToMove.map(m => m.id);
        const movedMessageIds: Snowflake[] = [];
        const failedList = [];

        // send notice to destination channel
        const msg = await destinationChannel.send(`Moving ${messagesToMove.length} messages from ${currentChannel.url} to ${destinationChannel.url}.`).catch(() => { });
        if (msg) movedMessageIds.push(msg.id);

        for (const msg of messagesToMove) {
            let content = msg.content;
            let files = msg.attachments;
            let embeds = msg.embeds;
            let author = msg.author;

            // move
            const contentSplit = splitIntoChunks(content, 2000);
            let failed = false;
            for (let i = 0; i === 0 || i < contentSplit.length; i++) {
                const part = contentSplit[i] || "";
                const isLast = i === Math.max(contentSplit.length - 1, 0);
                const sent = await webhook.send({
                    content: part,
                    username: author.displayName || author.username,
                    avatarURL: author.displayAvatarURL(),
                    files: isLast && files.size > 0 ? Array.from(files.values()).map(a => a.url) : undefined,
                    embeds: isLast && embeds.length > 0 ? embeds.map(e => e.toJSON()) : undefined,
                    allowedMentions: { parse: [] },
                }).catch((e) => {
                    console.error('Error sending webhook message:', e);
                    return null;
                });
                if (!sent) {
                    failed = true;
                } else {
                    movedMessageIds.push(sent.id);
                }
            }

            if (failed) {
                failedList.push(msg.url);
            }
        }

        await webhook.delete().catch(() => { });
        data.toMoveMessageIds = originalMessageIds;
        data.movedMessageIds = movedMessageIds;
        data.moveToChannelId = destinationChannel.id;
        // save data
        saveMoveConvoData(guildHolder.getBot(), data);


        const othersToDelete = [];

        await origMessage.delete().catch(() => { });
        if (failedList.length > 0) {
            const failedText = `Warning: Failed to move the following messages:\n` + failedList.map(url => `- ${url}`).join('\n');
            const failedChunks = splitIntoChunks(failedText, 2000);
            for (const chunk of failedChunks) {
                const message = await currentChannel.send({
                    content: chunk,
                    flags: [MessageFlags.SuppressNotifications]
                }).catch(() => {
                    // ignore
                });
                if (message) othersToDelete.push(message.id);
            }
        }

        await currentChannel.send(`Copied ${movedMessageIds.length} messages from ${currentChannel.url} to ${destinationChannel.url}`).catch(() => { });
        
        const confirmButton = (new MoveConvoCancelButton()).getBuilder();
        const cancelButton = (new MoveConvoConfirmButton()).getBuilder();
        const rows = [new ActionRowBuilder().addComponents(cancelButton, confirmButton) as any];
        const confirmMessage = await currentChannel.send({
            content: `Please confirm that the messages have been copied successfully. If so, click "Confirm" to delete the original messages. If there were issues, click "Undo" to delete the copied messages in ${destinationChannel}.`,
            flags: [MessageFlags.SuppressNotifications],
            components: rows
        }).catch((e) => {
            console.error('Error sending confirmation message:', e);
        });
        if (confirmMessage) othersToDelete.push(confirmMessage.id);

        data.statusMessages = othersToDelete;
        saveMoveConvoData(guildHolder.getBot(), data);





    }
}