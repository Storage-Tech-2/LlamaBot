import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder } from "discord.js";
import { Submission } from "../submissions/Submission";
import { getAuthorsString, getFileKey } from "../utils/Util";
import Path from "path";
import { Attachment } from "../submissions/Attachment";
import { ArchiveEntryData } from "../archive/ArchiveEntry";
import { GuildConfigs } from "../config/GuildConfigs";

export class PostEmbed {
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

    public static async createAttachmentMessage(submission: Submission, _submissionURL: string, commitID: string, path: string, entryData: ArchiveEntryData): Promise<{ content: string, files: AttachmentBuilder[] }> {
        const litematics: Attachment[] = []
        const others: Attachment[] = []
        const attachments = entryData.attachments;
        let description = `## Files for ${entryData.name}\n`;
        attachments.forEach(attachment => {
            if (attachment.litematic) {
                litematics.push(attachment)
            } else {
                others.push(attachment)
            }
        })

        const githubURL = submission.getGuildHolder().getConfigManager().getConfig(GuildConfigs.GITHUB_REPO_URL);
        // parse the URL to get the repo name and owner
        const urlParts = new URL(githubURL);
        const pathParts = urlParts.pathname.split('/');
        const repoOwner = pathParts[1];
        const repoName = pathParts[2];

        // construct a raw URL
        const rawURL = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${commitID}/${path}/`;

        if (litematics.length) {
            description += '**Litematics:**\n'
            litematics.forEach(attachment => {
                description += `- [${attachment.name}](${rawURL}/${attachment.path}): MC ${attachment.litematic?.version}, ${attachment.litematic?.size}\n`
            })
        }

        if (others.length) {
            description += '**Other files:**\n'
            others.forEach(attachment => {
                if (attachment.contentType === 'mediafire') {
                    description += `- [${attachment.name}](${attachment.url}): Mediafire link\n`
                    return;
                }
                description += `- [${attachment.name}](${rawURL}/${attachment.path}): ${attachment.contentType}\n`
            })
        }

        return {
            content: description,
            files: []
        }

    }

    public static async createInitialMessage(submission: Submission, submissionURL: string, commitID: string, path: string, entryData: ArchiveEntryData): Promise<{ content: string, files: AttachmentBuilder[] }> {
        let content = [];
      
        const description = entryData.description;
        const features = entryData.features;
        const considerations = entryData.considerations;
        const notes = entryData.notes;
        const authors = entryData.authors;
        const images = entryData.images;
        content.push(`**Authors:** ${getAuthorsString(authors)}\n`);
        content.push(description);

        if (features.length) {
            content.push('\n**Features:**');
            features.forEach(feature => content.push(`- ${feature}`));
        }

        if (considerations.length) {
            content.push('\n**Considerations:**');
            considerations.forEach(con => content.push(`- ${con}`));
        }

        if (notes.length) {
            content.push(`\n**Notes:**\n${notes}`);
        }

        const githubURL = submission.getGuildHolder().getConfigManager().getConfig(GuildConfigs.GITHUB_REPO_URL);
        // parse the URL to get the repo name and owner
        const urlParts = new URL(githubURL);
        const pathParts = urlParts.pathname.split('/');
        const repoOwner = pathParts[1];
        const repoName = pathParts[2];

    
        const gitURL = `https://github.com/${repoOwner}/${repoName}/tree/master/${path}`;
        const commitURL = `https://github.com/${repoOwner}/${repoName}/commit/${commitID}`;
        content.push(`\n[Submission Thread](${submissionURL})`);
        content.push(`[Github](${gitURL}) - [Commit](${commitURL})`);

        const files: AttachmentBuilder[] = [];
        images.forEach(image => {
            const key = getFileKey(image, 'png');
            const path = Path.join(submission.getProcessedImagesFolder(), key);
            const file = new AttachmentBuilder(path);
            // Replace ext of image with png
            let name = image.name.split('.');
            if (name.length > 1) {
                name.pop();
            }
            name.push('png');
            file.setName(name.join('.'));
            file.setDescription(image.description);
            files.push(file);
        });

        return {
            content: content.join('\n'),
            files: files
        };
    }

}

