import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType, MessageFlags, Message, Snowflake, Collection } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { replyEphemeral } from "../utils/Util.js";
import { getMoveConvoData, removeMoveConvoData } from "../support/MoveConvoTool.js";

export class BulkDeleteCommand implements Command {
    getID(): string {
        return "deleteconvo";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Deletes the conversation')
            .setContexts(InteractionContextType.Guild);
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
            await replyEphemeral(interaction, 'You have not marked any conversation to delete. Please use the context menu commands to mark the start and end of the conversation first.');
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
            content: `Deleting messages...`,
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

       
        // Delete messages
        for (const msg of messagesToMove) {
            await msg.delete().catch(() => { });
        }

        removeMoveConvoData(guildHolder.getBot(), interaction.user.id, interaction.channelId);

        const summary = `Deleted ${messagesToMove.length} messages from ${currentChannel.url}`;
      
        await origMessage.edit({
            content: summary,
        }).catch((e) => {
            console.error('Error sending confirmation message:', e);
        });
    }
}