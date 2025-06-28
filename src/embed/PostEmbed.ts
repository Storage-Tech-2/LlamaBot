import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, Message } from "discord.js";
import { areObjectsIdentical, escapeDiscordString, escapeString, getAuthorsString, getGithubOwnerAndProject, processImageForDiscord } from "../utils/Util.js";
import Path from "path";
import { Attachment } from "../submissions/Attachment.js";
import { ArchiveEntryData } from "../archive/ArchiveEntry.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { GuildHolder } from "../GuildHolder.js";

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

    public static async createAttachmentUpload(entryFolderPath: string, entryData: ArchiveEntryData): Promise<{ content: string, files: AttachmentBuilder[] }> {
        const files: AttachmentBuilder[] = [];
        const attachments = entryData.attachments;
        attachments.forEach(attachment => {
            if (!attachment.canDownload || !attachment.path) {
                return;
            }

            const key = escapeString(attachment.name);
            const filePath = Path.join(entryFolderPath, attachment.path);
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

    public static async createAttachmentMessage(guildHolder: GuildHolder, entryData: ArchiveEntryData, branchName: string, entryPathPart: string, uploadMessage: Message): Promise<{ content: string, files: AttachmentBuilder[] }> {
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

        const githubURL = guildHolder.getConfigManager().getConfig(GuildConfigs.GITHUB_REPO_URL);
        // parse the URL to get the repo name and owner
        const { owner, project } = getGithubOwnerAndProject(githubURL);
        // construct a raw URL
        const rawURL = `https://raw.githubusercontent.com/${owner}/${project}/refs/heads/${branchName}/${entryPathPart}`;

        if (litematics.length) {
            description += '**Litematics:**\n'
            litematics.forEach(attachment => {
                const url = attachmentURLs.get(attachment.name) || attachment.url;
                const githubLink = `${rawURL}/${attachment.path}`;
                const viewerURL = `https://schemat.io/view?url=${githubLink}`;
                description += `- ${url} [[Github]](${githubLink}) [[Viewer]](${viewerURL}): ` + (attachment.litematic?.error || `MC ${attachment.litematic?.version}, Size ${attachment.litematic?.size} \n`);
            })
        }

        if (others.length) {
            description += '**Other files:**\n'
            others.forEach(attachment => {
                if (attachment.contentType === 'mediafire') {
                    description += `- [${escapeDiscordString(attachment.name)}](${attachment.url}): Mediafire link\n`
                    return;
                } else if (attachment.contentType === 'youtube') {
                    description += `- [${escapeDiscordString(attachment.name)}](${attachment.url}): YouTube video\n`
                    return;
                } else if (attachment.canDownload) {
                    const url = attachmentURLs.get(attachment.name) || attachment.url;
                    description += `- ${url} [Github](${rawURL}/${attachment.path}): Discord link\n`
                    return;
                } else {
                    description += `- [${escapeDiscordString(attachment.name)}](${attachment.url}): ContentType ${attachment.contentType}\n`
                    return;
                }
            })
        }

        return {
            content: description,
            files: []
        }

    }

    public static createInitialMessage(guildHolder: GuildHolder, entryData: ArchiveEntryData, entryPathPart: string): string {
        let content = [];

        const description = entryData.description;
        const features = entryData.features;
        const considerations = entryData.considerations;
        const notes = entryData.notes;
        const authors = entryData.authors;


        if (authors.length > 0) {
            content.push(`**Authors:** ${getAuthorsString(authors)}`);
        }

        // check if authors and endorsers are the same
        if (entryData.authors.length === entryData.endorsers.length &&
            entryData.authors.every(author => entryData.endorsers.some(endorser => areObjectsIdentical(author, endorser)))) {
            // if they are the same, do not show endorsers
        } else {
            content.push(`**Endorsed by:** ${getAuthorsString(entryData.endorsers)}`);
        }

        content.push('\n' + description);

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

        const githubURL = guildHolder.getConfigManager().getConfig(GuildConfigs.GITHUB_REPO_URL);
        // parse the URL to get the repo name and owner
        const { owner, project } = getGithubOwnerAndProject(githubURL);

        const submissionThreadID = entryData.id;
        // const submissionsForumID = guildHolder.getConfigManager().getConfig(GuildConfigs.SUBMISSION_CHANNEL_ID);

        const submissionURL = `https://discord.com/channels/${guildHolder.getGuild().id}/${submissionThreadID}`;

        const gitURL = `https://github.com/${owner}/${project}/tree/master/${entryPathPart}#readme`;
        content.push(`\n[Submission Thread](${submissionURL})`);
        content.push(`[Github](${gitURL})`);
        content.push(`Edited on <t:${Math.floor(entryData.timestamp / 1000)}:F>`);

        return content.join('\n');
    }

    public static async createImageFiles(entryData: ArchiveEntryData, archivePath: string, entryPathPart: string, isGalleryView: boolean): Promise<{files: AttachmentBuilder[], paths: string[]}> {
        //   try {
        //             const images = this.config.getConfig(SubmissionConfigs.IMAGES) || [];
        //             const processedFolder = this.getProcessedImagesFolder();
        //             const downloadFolder = Path.join(this.folderPath, 'downloaded_images');
        //             await processImages(images, downloadFolder, processedFolder, false);
        //             this.imagesProcessing = false;
        //         } catch (error: any) {
        //             this.imagesProcessing = false;
        //             console.error('Error processing images:', error.message);
        //             throw error;
        //         }
        //    }
        const images = entryData.images.filter(i => i.path);
        const paths: string[] = [];
        const files: AttachmentBuilder[] = [];
        await Promise.all(images.map(async (image, i) => {
            if (!image.path) {
                return null
            }
            const path = Path.join(archivePath, entryPathPart, image.path);
            let newPath = null;
            try {
                newPath = await processImageForDiscord(path, images.length, i, isGalleryView);
                paths.push(newPath);
            } catch (error: any) {
                console.error('Error processing image for discord:', error.message);
            }
            const file = new AttachmentBuilder(newPath === null ? path : newPath);
            file.setName(image.name);
            file.setDescription(image.description);
            files.push(file);
        }));

        return {
            files: files,
            paths: paths
        }
    }
}

