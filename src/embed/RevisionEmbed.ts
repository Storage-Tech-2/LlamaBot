import { ActionRowBuilder, EmbedBuilder } from "discord.js";
import { Submission } from "../submissions/Submission.js";
import { Revision } from "../submissions/Revision.js";
import { EditSubmissionButton } from "../components/buttons/EditSubmissionButton.js";
import { MakeRevisionCurrentButton } from "../components/buttons/MakeRevisionCurrentButton.js";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs.js";
import { getAuthorsString } from "../utils/Util.js";

export class RevisionEmbed {
    private embed: EmbedBuilder;
    private row: ActionRowBuilder;

    constructor(embed: EmbedBuilder, row: ActionRowBuilder) {
        this.embed = embed;
        this.row = row;
    }

    public getEmbed(): EmbedBuilder {
        return this.embed;
    }

    public getRow(): ActionRowBuilder {
        return this.row;
    }

    public static async create(submission: Submission, revision: Revision, isCurrent = false): Promise<RevisionEmbed> {
        // const submissionData = submission.submissionData
        const embed = new EmbedBuilder()
        // const files = []
        //   if (submissionData?.image?.processed) {
        //     const file = new AttachmentBuilder(submissionData.image.processed)
        //     embed
        //       .setImage('attachment://processed.png')
        //     files.push(file)
        //   }

        embed.setColor(isCurrent ? '#0099ff' : '#ff9900')
        embed.setTitle(`Submission Draft${isCurrent ? ' (Current)' : ''}`)
        let description = ''

        // Check name
        const channel = await submission.getSubmissionChannel();
        submission.getConfigManager().setConfig(SubmissionConfigs.NAME, channel.name);
        description += `## ${submission.getConfigManager().getConfig(SubmissionConfigs.NAME)}\n`;

        const authors = submission.getConfigManager().getConfig(SubmissionConfigs.AUTHORS) || [];
        description += `**Authors:** ${getAuthorsString(authors)}\n`

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

        embed.setDescription(description)

        embed.setFooter({
            text: 'This is a draft submission. Reply to this message with instructions to update it.'
        })

        const row = new ActionRowBuilder()
            .addComponents(new EditSubmissionButton().getBuilder())

        if (!isCurrent) {
            row.addComponents(new MakeRevisionCurrentButton().getBuilder())
        }
        //     row.addComponents(await FinalizeButton.getComponent(finalized))
        // }

        return new RevisionEmbed(embed, row);
    }

}

