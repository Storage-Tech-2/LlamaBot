import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, Message } from "discord.js";
import { areObjectsIdentical, escapeDiscordString, escapeString, getAuthorsString, getGithubOwnerAndProject } from "../utils/Util.js";
import Path from "path";
import { Attachment } from "../submissions/Attachment.js";
import { ArchiveEntryData } from "../archive/ArchiveEntry.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { GuildHolder } from "../GuildHolder.js";
import fs from "fs/promises";
import { processImageForDiscord } from "../utils/AttachmentUtils.js";
import { postToMarkdown } from "../utils/MarkdownUtils.js";

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
        const attachments = entryData.attachments;
        const files = (await Promise.all(attachments.map(async attachment => {
            if (!attachment.canDownload || !attachment.path) {
                return null;
            }

            const key = escapeString(attachment.name);
            const filePath = Path.join(entryFolderPath, attachment.path);

            // Check file size is less than 8MB
            const stats = await fs.stat(filePath);
            if (stats.size > 8 * 1024 * 1024) {
                return null;
            }

            const file = new AttachmentBuilder(filePath);
            file.setName(key);
            file.setDescription(attachment.description || '');
            return file;
        }))).filter(file => file !== null);
        return {
            content: `This message contains the files for the submission **${entryData.name}**.`,
            files: files
        }
    }

    public static async createAttachmentMessage(guildHolder: GuildHolder, entryData: ArchiveEntryData, branchName: string, entryPathPart: string, uploadMessage: Message | null): Promise<string> {
        const attachmentURLs = new Map();
        if (uploadMessage) {
            uploadMessage.attachments.forEach(attachment => {
                attachmentURLs.set(attachment.name, attachment.url);
            });
        }

        const litematics: Attachment[] = []
        const wdls: Attachment[] = []
        const videos: Attachment[] = []
        const others: Attachment[] = []
        const attachments = entryData.attachments;
        let description = `## Files for ${entryData.name}\n`;
        attachments.forEach(attachment => {
            if (attachment.contentType === 'youtube' || attachment.contentType === 'bilibili') {
                videos.push(attachment);
            } else if (attachment.litematic) {
                litematics.push(attachment)
            } else if (attachment.wdl) {
                wdls.push(attachment)
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
            description += '### Litematics\n'
            litematics.forEach(attachment => {
                const url = attachmentURLs.get(attachment.name) || attachment.url;
                const githubLink = `${rawURL}/${attachment.path}`;
                const viewerURL = `https://schemat.io/view?url=${githubLink}`;
                description += `- ${url} [[Schemat.io Viewer]](${viewerURL}): ` + (attachment.litematic?.error || `MC ${attachment.litematic?.version}, Size ${attachment.litematic?.size} \n`);
            })
        }

        if (wdls.length) {
            description += '### WDLs\n'
            wdls.forEach(attachment => {
                const url = attachmentURLs.get(attachment.name) || attachment.url;
                description += `- ${url} [[Github Mirror]](${rawURL}/${attachment.path}): ${attachment.wdl?.error || `MC ${attachment.wdl?.version}`}\n`
            })
        }

        if (videos.length) {
            description += '### Videos\n'
            videos.forEach(attachment => {
                if (attachment.contentType === 'bilibili') {
                    description += `- [${attachment.name}](${attachment.url}): Bilibili video\n`
                    return;
                }
                if (!attachment.youtube) {
                    description += `- [${escapeDiscordString(attachment.name)}](${attachment.url}): YouTube link\n`
                    return;
                }
                description += `- [${escapeDiscordString(attachment.youtube.title)}](${attachment.url}): by [${escapeDiscordString(attachment.youtube.author_name)}](${attachment.youtube.author_url})\n`
            })
        }

        if (others.length) {
            description += '### Other files\n'
            others.forEach(attachment => {
                if (attachment.contentType === 'mediafire') {
                    description += `- [${escapeDiscordString(attachment.name)}](${attachment.url}): Mediafire link\n`
                    return;
                } else if (attachment.contentType === 'youtube') {
                    description += `- [${escapeDiscordString(attachment.name)}](${attachment.url}): YouTube video\n`
                    return;
                } else if (attachment.canDownload) {
                    const url = attachmentURLs.get(attachment.name) || attachment.url;
                    description += `- ${url} [[Github Mirror]](${rawURL}/${attachment.path}): Discord link\n`
                    return;
                } else {
                    description += `- [${escapeDiscordString(attachment.name)}](${attachment.url}): ContentType ${attachment.contentType}\n`
                    return;
                }
            })
        }

        return description;
    }

    public static createAttachmentViewerMessage(viewerAttachments: Attachment[], uploadMessage: Message | null): string {
        const attachmentURLs = new Map();
        if (uploadMessage) {
            uploadMessage.attachments.forEach(attachment => {
                attachmentURLs.set(attachment.name, attachment.url);
            });
        }

        let description = ``;

        viewerAttachments.forEach((attachment)=>{
            description += attachmentURLs.get(attachment.name) || attachment.url + '\n';
        });

        return description;
    }


    public static createInitialMessage(guildHolder: GuildHolder, entryData: ArchiveEntryData, entryPathPart: string): string {
        let content = [];

        const authors = entryData.authors;


        if (authors.length > 0) {
            content.push(`**Authors:** ${getAuthorsString(authors.filter(a => !a.dontDisplay))}\n`);
        }

        // check if authors and endorsers are the same
        if (entryData.endorsers.length === 0 || (entryData.authors.length === entryData.endorsers.length &&
            entryData.authors.every(author => entryData.endorsers.some(endorser => areObjectsIdentical(author, endorser))))) {
            // if they are the same, do not show endorsers
        } else {
            content.push(`**Endorsed by:** ${getAuthorsString(entryData.endorsers)}\n`);
        }

        content.push('\n' + postToMarkdown(entryData.records));

        const authorsWithReasons = entryData.authors.filter(author => author.reason);
        if (authorsWithReasons.length > 0) {
            content.push(`\n## Acknowledgements`);
            authorsWithReasons.forEach(author => {
                content.push(`\n- ${getAuthorsString([author])}: ${author.reason}`);
            });
        }

        const githubURL = guildHolder.getConfigManager().getConfig(GuildConfigs.GITHUB_REPO_URL);
        // parse the URL to get the repo name and owner
        const { owner, project } = getGithubOwnerAndProject(githubURL);

        const submissionThreadID = entryData.id;
        // const submissionsForumID = guildHolder.getConfigManager().getConfig(GuildConfigs.SUBMISSION_CHANNEL_ID);

        const submissionURL = `https://discord.com/channels/${guildHolder.getGuild().id}/${submissionThreadID}`;

        const gitURL = `https://github.com/${owner}/${project}/tree/master/${entryPathPart}#readme`;
        content.push(`\n\n[Submission Thread](${submissionURL})`);
        content.push(`\n[Github](${gitURL})`);

        const websiteURL = guildHolder.getConfigManager().getConfig(GuildConfigs.WEBSITE_URL);
        if (websiteURL) {
            const postURLObj = new URL(websiteURL);
            postURLObj.searchParams.append('id', entryData.id);
            content.push(` | [Website](${postURLObj.href})`);
        }
        content.push(`\nEdited on <t:${Math.floor(entryData.timestamp / 1000)}:F>`);

        return content.join('');
    }

    public static async createImageFiles(entryData: ArchiveEntryData, archivePath: string, entryPathPart: string, isGalleryView: boolean): Promise<{ files: AttachmentBuilder[], paths: string[] }> {
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
        const files = (await Promise.all(images.map(async (image, i) => {
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
            return file;
        }))).filter(file => file !== null);

        // reverse files
        //files.reverse();
        // reverse paths
        //paths.reverse();

        return {
            files: files,
            paths: paths
        }
    }
}

