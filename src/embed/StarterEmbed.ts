import { ActionRowBuilder, EmbedBuilder } from "discord.js";
import { Submission } from "../submissions/Submission";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs";
import { SetArchiveChannelButton } from "../components/buttons/SetArchiveChannelButton";
import { SetTagsButton } from "../components/buttons/SetTagsButton";
import { SetImagesButton } from "../components/buttons/SetImagesButton";
import { SetAttachmentsButton } from "../components/buttons/SetAttachmentsButton";

export class StarterEmbed {
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

    public static async create(submission: Submission): Promise<StarterEmbed> {
        const configs = submission.getConfigManager();
        const archiveChannelID = configs.getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        const tags = configs.getConfig(SubmissionConfigs.TAGS);
        const images = configs.getConfig(SubmissionConfigs.IMAGES);
        const attachments = configs.getConfig(SubmissionConfigs.ATTACHMENTS);

        const embed = new EmbedBuilder()
        embed.setColor('#0099ff')
        embed.setTitle('Submission Status')

        let description = 'Thank you for submitting your work! Before we can publish your submission, the following needs to be completed:'
        description += '\n\n**Submission Progress**\n'
        if (archiveChannelID) {
            description += `:white_check_mark: Chose a channel: <#${archiveChannelID}>\n`
        } else {
            description += ':one: Choose a channel\n'
        }

        if (tags !== null) {
            description += `:white_check_mark: Chose tags: ${tags.length ? tags.join(', ') : 'No tags'}\n`
        } else {
            description += ':two: Choose tags\n'
        }

        if (images) {
            description += `:white_check_mark: Chose images: ${images.map(o=>o.name).join(", ")}\n`
        } else {
            description += ':three: Choose image\n'
        }

        if (attachments !== null) {
            description += `:white_check_mark: Finalized attachments: ${attachments.length ? attachments.map(o => o.name).join(', ') : 'No attachments'}\n`
        } else {
            description += ':four: Finalize attachments\n'
        }

        description += `\nLast updated: <t:${Math.floor(Date.now() / 1000)}:F>`

        // Link to the latest version of the submission
        const currentRevision = submission.getRevisionsManager().getCurrentRevision();
        if (currentRevision) {
            const message = await (await submission.getSubmissionChannel()).messages.fetch(currentRevision.id);
            description += `\n\n[View latest submission draft](${message.url})`
        }

        embed.setDescription(description)

        
        // Post

        const row = new ActionRowBuilder()
           .addComponents(await new SetArchiveChannelButton().getBuilder(!!archiveChannelID))

        if (archiveChannelID) {
            row.addComponents(await new SetTagsButton().getBuilder(tags !== null))

            if (tags !== null) {
                row.addComponents(await new SetImagesButton().getBuilder(images !== null))

                if (images !== null) {
                    row.addComponents(await new SetAttachmentsButton().getBuilder(attachments !== null));
                }
            }
        }

        return new StarterEmbed(embed, row);
    }

}