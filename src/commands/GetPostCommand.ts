import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType, ChannelType } from "discord.js";
import { GuildHolder } from "../GuildHolder.js";
import { Command } from "../interface/Command.js";
import { isEditor, isEndorser, isModerator, replyEphemeral } from "../utils/Util.js";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs.js";
import { AuthorType } from "../submissions/Author.js";

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

        // fetch forum channel
        const forumChannel = await guildHolder.getGuild().channels.fetch(post.forumId).catch(() => null);
        if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
            await replyEphemeral(interaction, `The post with code \`${code}\` is not in a valid forum channel.`);
            return;
        }

        // get thread
        const thread = await forumChannel.threads.fetch(post.threadId).catch(() => null);
        if (!thread) {
            await replyEphemeral(interaction, `The thread for the post with code \`${code}\` does not exist or has been deleted.`);
            return;
        }

        // get message
        const message = await thread.messages.fetch(post.messageId).catch(() => null);
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