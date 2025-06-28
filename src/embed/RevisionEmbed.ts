import { ActionRowBuilder, Channel, EmbedBuilder, Message, MessageFlags } from "discord.js";
import { Submission } from "../submissions/Submission.js";
import { Revision } from "../submissions/Revision.js";
import { EditSubmissionButton } from "../components/buttons/EditSubmissionButton.js";
import { MakeRevisionCurrentButton } from "../components/buttons/MakeRevisionCurrentButton.js";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs.js";
import { getAuthorsString, splitIntoChunks } from "../utils/Util.js";

export class RevisionEmbed {
    private embeds: EmbedBuilder[];
    private row: ActionRowBuilder;

    constructor(embeds: EmbedBuilder[], row: ActionRowBuilder) {
        this.embeds = embeds;
        this.row = row;
    }

    public getEmbeds(): EmbedBuilder[] {
        return this.embeds;
    }

    public getRow(): ActionRowBuilder {
        return this.row;
    }

    public static async sendRevisionMessages(channel: Channel, submission: Submission, revision: Revision, isCurrent = false): Promise<Message[]> {
        if (!channel.isSendable()) {
            throw new Error('Channel is not sendable');
        }
        const embed = await RevisionEmbed.create(submission, revision, isCurrent);
        const embeds = embed.getEmbeds();
        const row = embed.getRow();
        const messages: Message[] = [];
        for (let i = 0; i < embeds.length; i++) {
            const message = await channel.send({
                embeds: [embeds[i]],
                components: i === embeds.length - 1 ? [row as any] : [],
                flags: [MessageFlags.SuppressNotifications]
            });
            messages.push(message);
        }
        return messages;
    }

    public static async editRevisionMessages(existingMessages: Message[], submission: Submission, revision: Revision, isCurrent = false) {
        const embed = await RevisionEmbed.create(submission, revision, isCurrent);
        const embeds = embed.getEmbeds();
        if (existingMessages.length !== embeds.length) {
            throw new Error('Number of existing messages does not match number of embeds');
        }
        const row = embed.getRow();
        for (let i = 0; i < embeds.length; i++) {
            await existingMessages[i].edit({
                embeds: [embeds[i]],
                components: i === embeds.length - 1 ? [row as any] : [],
            });
        }
    }

    private static async create(submission: Submission, revision: Revision, isCurrent = false): Promise<RevisionEmbed> {
        // const submissionData = submission.submissionData

        let description = ''

        // Check name
        const channel = await submission.getSubmissionChannel();
        submission.getConfigManager().setConfig(SubmissionConfigs.NAME, channel.name);
        description += `## ${submission.getConfigManager().getConfig(SubmissionConfigs.NAME)}\n`;

        const authors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || [];
        description += `**Authors:** ${getAuthorsString(authors.filter(a=>!a.dontDisplay))}\n`

        description += `**Description:** ${revision.description}`

        if (revision.features.length) {
            description += '\n\n**Features**'
            revision.features.forEach((feature) => {
                description += `\n- ${feature}`
            })
        }

        if (revision.considerations.length) {
            description += '\n\n**Considerations**'
            revision.considerations.forEach((con) => {
                description += `\n- ${con}`
            })
        }

        if (revision.notes.length) {
            description += '\n\n**Notes**\n'
            description += revision.notes
        }

        const authorsWithReasons = authors.filter(author => author.reason);
        if (authorsWithReasons.length > 0) {
            description += `\n\n**Acknowledgements:**\n`;
            authorsWithReasons.forEach(author => {
                description += `- ${getAuthorsString([author])}: ${author.reason}\n`;
            });
        }

        const chunks = splitIntoChunks(description, 4096);
        const embeds = chunks.map((chunk, index) => {
            const embed = new EmbedBuilder()
            embed.setColor(isCurrent ? '#0099ff' : '#ff9900')
            if (index === 0) {
                embed.setTitle(`Submission Draft${isCurrent ? ' (Current)' : ''}`)
            } else {
                embed.setTitle(`Submission Draft (Part ${index + 1})${isCurrent ? ' (Current)' : ''}`)
            }
            embed.setDescription(chunk)
            if (index === chunks.length - 1) {
                embed.setFooter({
                    text: 'This is a draft submission. Reply to this message with instructions to update it.'
                })
            }
            return embed;
        });


        const row = new ActionRowBuilder()
            .addComponents(new EditSubmissionButton().getBuilder())

        if (!isCurrent) {
            row.addComponents(new MakeRevisionCurrentButton().getBuilder())
        }
        //     row.addComponents(await FinalizeButton.getComponent(finalized))
        // }

        return new RevisionEmbed(embeds, row);
    }

}

