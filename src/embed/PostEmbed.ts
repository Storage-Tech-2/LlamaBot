import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, Message } from "discord.js";
import { Submission } from "../submissions/Submission";
import { escapeString, getAuthorsString, getFileKey, getGithubOwnerAndProject } from "../utils/Util";
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

    public static async createAttachmentUpload(_submission: Submission, _submissionURL: string, _commitID: string, path: string, entryData: ArchiveEntryData): Promise<{ content: string, files: AttachmentBuilder[] }> {
        const files: AttachmentBuilder[] = [];
        const attachments = entryData.attachments;
        attachments.forEach(attachment => {
            if (attachment.contentType === 'mediafire' || !attachment.path) {
                return;
            }

            const key = escapeString(attachment.name);
            const filePath = Path.join(path, attachment.path);
            const file = new AttachmentBuilder(filePath);
            file.setName(key);
            file.setDescription(attachment.description || '');
            files.push(file);
        });
        return {
            content: `This message contains the files for the submission **${entryData.name}**.`,
            files: files
        }
    }

    public static async createAttachmentMessage(submission: Submission, _submissionURL: string, commitID: string, path: string, entryData: ArchiveEntryData, uploadMessage: Message): Promise<{ content: string, files: AttachmentBuilder[] }> {
        const attachmentURLs = new Map();
        uploadMessage.attachments.forEach(attachment => {
            attachmentURLs.set(attachment.name, attachment.url);
        });
        
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
        const { owner, project } = getGithubOwnerAndProject(githubURL);
        // construct a raw URL
        const rawURL = `https://raw.githubusercontent.com/${owner}/${project}/${commitID}/${path}`;

        if (litematics.length) {
            description += '**Litematics:**\n'
            litematics.forEach(attachment => {
                const url = attachmentURLs.get(attachment.name) || attachment.url;
                description += `- ${url} [Github](${rawURL}/${attachment.path}): MC ${attachment.litematic?.version}, ${attachment.litematic?.size}\n`
            })
        }

        if (others.length) {
            description += '**Other files:**\n'
            others.forEach(attachment => {
                if (attachment.contentType === 'mediafire') {
                    description += `- [${attachment.name}](${attachment.url}): Mediafire link\n`
                    return;
                }
                const url = attachmentURLs.get(attachment.name) || attachment.url;
                description += `- ${url} [Github](${rawURL}/${attachment.path}): ${attachment.contentType}\n`
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
        content.push(`**Authors:** ${getAuthorsString(authors)}`);
        content.push(`**Endorsered by:** ${getAuthorsString(entryData.endorsers)}\n`);
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
        const { owner, project } = getGithubOwnerAndProject(githubURL);


        const gitURL = `https://github.com/${owner}/${project}/tree/master/${path}`;
        const commitURL = `https://github.com/${owner}/${project}/commit/${commitID}`;
        content.push(`\n[Submission Thread](${submissionURL})`);
        content.push(`[Github](${gitURL}) - [Commit](${commitURL})`);
        content.push(`Edited on <t:${Math.floor(entryData.timestamp / 1000)}:F>`);

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

