import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType, ChannelType } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { replyEphemeral } from "../utils/Util.js";

export class GetPostCommand implements Command {
    getID(): string {
        return "getpost";
    }

    getBuilder(_guildHolder: GuildHolder): SlashCommandBuilder {
        const data = new SlashCommandBuilder()
        data.setName(this.getID())
            .setDescription('Get a post by its unique code')
            .setContexts(InteractionContextType.Guild);
        data.addStringOption(option =>
            option.setName('code')
                .setDescription('The unique code of the post')
                .setRequired(true)
        );
        return data;
    }

    async execute(guildHolder: GuildHolder, interaction: ChatInputCommandInteraction): Promise<void> {
        if (
            !interaction.inGuild()
        ) {
            await replyEphemeral(interaction, 'This command can only be used in a forum channel.')
            return;
        }

        // Find the post by code
        const code = interaction.options.getString('code', true);
        const found = await guildHolder.getRepositoryManager().findEntryBySubmissionCode(code);
        if (!found) {
            await replyEphemeral(interaction, `No post found with code \`${code}\`.`);
            return;
        }

        const post = found.entry.getData().post;
        
        if (!post) {
            await replyEphemeral(interaction, `The post with code \`${code}\` does not exist or has been deleted.`);
            return;
        }

        // fetch channel
        const threadChannel = await guildHolder.getGuild().channels.fetch(post.threadId).catch(() => null);
        if (!threadChannel || !threadChannel.isTextBased()) {
            await replyEphemeral(interaction, `The post with code \`${code}\` is not in a valid thread channel.`);
            return;
        }

        // get message
        const message = await threadChannel.messages.fetch(post.messageId).catch(() => null);
        if (!message) {
            await replyEphemeral(interaction, `The message for the post with code \`${code}\` does not exist or has been deleted.`);
            return;
        }

        await interaction.reply({
            content: `Found post with code \`${code}\`:`,
        });

        // forward the message to the user
        await message.forward(interaction.channelId);
    }

}