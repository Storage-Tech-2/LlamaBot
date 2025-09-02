import { InteractionContextType, ApplicationCommandType, ContextMenuCommandInteraction, ContextMenuCommandBuilder, MessageFlags } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { replyEphemeral } from "../utils/Util.js";
import { ContextMenuCommand } from "../interface/ContextMenuCommand.js";
import { getOrMakeMoveConvoData, saveMoveConvoData } from "../support/MoveConvoTool.js";

export class MoveConvoStartContextCommand implements ContextMenuCommand {
    getID(): string {
        return "Mark Convo Start";
    }

    getBuilder(_guildHolder: GuildHolder): ContextMenuCommandBuilder {
        const data = new ContextMenuCommandBuilder()
        data.setName(this.getID())
            .setType(ApplicationCommandType.Message)
            .setContexts(InteractionContextType.Guild);
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ContextMenuCommandInteraction): Promise<void> {
        if (
            !interaction.inGuild()
        ) {
            await replyEphemeral(interaction, 'This command can only be used in a forum channel.')
            return;
        }

        // check perms
        if (!interaction.memberPermissions.has('ManageMessages')) {
            await replyEphemeral(interaction, 'You do not have permission to use this command!');
            return;
        }


        if (!interaction.isMessageContextMenuCommand()) {
            await replyEphemeral(interaction, 'This command can only be used on messages.');
            return;
        }

        const message = interaction.targetMessage;
        if (!message) {
            await replyEphemeral(interaction, 'No message found to move the conversation after.');
            return;
        }
        
        const data = getOrMakeMoveConvoData(guildHolder.getBot(), interaction.user.id, interaction.channelId);
        data.startMessageId = message.id;
        saveMoveConvoData(guildHolder.getBot(), data);

        await interaction.reply({
            content: `Conversation start marked at ${message.url}`,
            flags: [MessageFlags.Ephemeral]
        });
    }

}