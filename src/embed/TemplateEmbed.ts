import { Channel, EmbedBuilder, Message, MessageFlags } from "discord.js";
import { splitIntoChunks } from "../utils/Util.js";
import { schemaToMarkdownTemplate } from "../utils/MarkdownUtils.js";
import { GuildHolder } from "../GuildHolder.js";

export class TemplateEmbed {
    private embeds: EmbedBuilder[];
    constructor(embeds: EmbedBuilder[]) {
        this.embeds = embeds;
    }

    public getEmbeds(): EmbedBuilder[] {
        return this.embeds;
    }

    public static async sendTemplateMessages(channel: Channel, guildHolder: GuildHolder): Promise<Message[]> {
        if (!channel.isSendable()) {
            throw new Error('Channel is not sendable');
        }
        const embed = await TemplateEmbed.create(guildHolder);
        const embeds = embed.getEmbeds();
        const messages: Message[] = [];
        for (let i = 0; i < embeds.length; i++) {
            const message = await channel.send({
                embeds: [embeds[i]],
                flags: [MessageFlags.SuppressNotifications]
            });
            messages.push(message);
        }
        return messages;
    }

    private static async create(guildHolder: GuildHolder): Promise<TemplateEmbed> {
        // const submissionData = submission.submissionData

        let description = ''


        const schema = guildHolder.getSchema();
        description += `# New Post Template\n`;

        description += `**Authors:** <@${guildHolder.getBot().client.user?.id}>\n\n`

        description += schemaToMarkdownTemplate(schema);

        description += `\n## Acknowledgements\n`;

        description += `- <@${guildHolder.getBot().client.user?.id}>: For being awesome.\n`;


        const chunks = splitIntoChunks(description, 4096);
        const embeds = chunks.map((chunk, index) => {
            const embed = new EmbedBuilder()
            embed.setColor('#0099ff')
            if (index === 0) {
                embed.setTitle(`Post Template`)
            } else {
                embed.setTitle(`Post Template (Part ${index + 1})`)
            }
            embed.setDescription(chunk)
            if (index === chunks.length - 1) {
                embed.setFooter({
                    text: 'This is a template for new posts. You can edit it using the `/mwa settemplate` command.',
                })
            }
            return embed;
        });

        return new TemplateEmbed(embeds);
    }

}

