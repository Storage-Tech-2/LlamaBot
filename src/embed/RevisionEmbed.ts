import { ActionRowBuilder, EmbedBuilder } from "discord.js";
import { Submission } from "../submissions/Submission";
import { Revision } from "../submissions/Revision";
import { EditSubmissionButton } from "../components/buttons/EditSubmissionButton";
import { MakeRevisionCurrentButton } from "../components/buttons/MakeRevisionCurrentButton";

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

    public static async create(revision: Revision, isCurrent = false, finalized = false): Promise<RevisionEmbed> {
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
        description += `## [${revision.minecraftVersion || 'N/A'}] ${revision.name || 'No Name'}\n`

        description += `**Authors:** ${revision.authors.map(o=>o.name).join(', ')}\n`

        description += `**Description:** ${revision.description}`

        if (revision.features.length) {
            description += '\n\n**Features**\n'
            revision.features.forEach((feature) => {
                description += `- ${feature}\n`
            })
        }

        if (revision.considerations.length) {
            description += '\n\n**Considerations**\n'
            revision.considerations.forEach((con) => {
                description += `- ${con}\n`
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
            .addComponents(await new EditSubmissionButton().getBuilder())

        if (!isCurrent) {
            row.addComponents(await new MakeRevisionCurrentButton().getBuilder())
        }
        //     row.addComponents(await FinalizeButton.getComponent(finalized))
        // }

        return new RevisionEmbed(embed, row);
    }

}

