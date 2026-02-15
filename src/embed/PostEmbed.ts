import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, Message } from "discord.js";
import { areObjectsIdentical, buildGithubMediaContentURL, buildGithubRawContentURL, escapeString, getAuthorsString, getGithubOwnerAndProject, splitIntoChunks } from "../utils/Util.js";
import Path from "path";
import { Attachment } from "../submissions/Attachment.js";
import { ArchiveEntryData } from "../archive/ArchiveEntry.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import { GuildHolder } from "../GuildHolder.js";
import fs from "fs/promises";
import { getAttachmentCategory, getAttachmentPostMessage, getFileExtension, processImageForDiscord } from "../utils/AttachmentUtils.js";
import { postToMarkdown } from "../utils/MarkdownUtils.js";
import { transformOutputWithReferencesForDiscord } from "../utils/ReferenceUtils.js";
import { buildEntrySlug } from "../utils/SlugUtils.js";
import { RepositoryConfigs } from "../archive/RepositoryConfigs.js";

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
        const schematics: Attachment[] = []
        const wdls: Attachment[] = []
        const videos: Attachment[] = []
        const images: Attachment[] = []
        const others: Attachment[] = []
        const attachments = entryData.attachments;
        let description = `## Files for ${entryData.name}\n`;
        attachments.forEach(attachment => {
            switch (getAttachmentCategory(attachment)) {
                case 'video':
                    videos.push(attachment);
                    break;
                case 'litematic':
                    litematics.push(attachment);
                    break;
                case 'schematic':
                    schematics.push(attachment);
                    break;
                case 'wdl':
                    wdls.push(attachment);
                    break;
                case 'image':
                    images.push(attachment);
                    break;
                default:
                    others.push(attachment);
                    break;
            }
        });

        const githubURL = guildHolder.getConfigManager().getConfig(GuildConfigs.GITHUB_REPO_URL);
        // parse the URL to get the repo name and owner
        const { owner, project } = getGithubOwnerAndProject(githubURL);
        // construct a raw URL
        const rawURL = buildGithubRawContentURL(owner, project, branchName, entryPathPart);
        const mediaURL = buildGithubMediaContentURL(owner, project, branchName, entryPathPart);

        const lfsExtensions = guildHolder.getRepositoryManager().getConfigManager().getConfig(RepositoryConfigs.LFS_EXTENSIONS);
        const getAttachmentGithubURL = (attachment: Attachment) => {
            if (!attachment.path) return null;
            const ext = getFileExtension(attachment.name).toLowerCase();
            if (lfsExtensions.includes(ext)) {
                return `${mediaURL}/${attachment.path}`;
            }
            return `${rawURL}/${attachment.path}`;
        }
        
        if (litematics.length) {
            description += '### Litematics\n'
            litematics.forEach(attachment => {
                const githubLink = getAttachmentGithubURL(attachment);
                description += getAttachmentPostMessage(attachment, {
                    uploadedURL: attachmentURLs.get(attachment.name) || attachment.url,
                    githubLink
                });
            })
        }

        if (schematics.length) {
            description += '### Schematics\n'
            schematics.forEach(attachment => {
                const githubLink = getAttachmentGithubURL(attachment);
                description += getAttachmentPostMessage(attachment, {
                    uploadedURL: attachmentURLs.get(attachment.name) || attachment.url,
                    githubLink
                });
            })
        }

        if (wdls.length) {
            description += '### WDLs\n'
            wdls.forEach(attachment => {
                const githubLink = getAttachmentGithubURL(attachment);
                description += getAttachmentPostMessage(attachment, {
                    uploadedURL: attachmentURLs.get(attachment.name) || attachment.url,
                    githubLink
                });
            })
        }

        if (videos.length) {
            description += '### Videos\n'
            videos.forEach(attachment => {
                const githubLink = getAttachmentGithubURL(attachment);
                description += getAttachmentPostMessage(attachment, {
                    uploadedURL: attachmentURLs.get(attachment.name) || attachment.url,
                    githubLink
                });
            })
        }

        if (images.length) {
            description += '### Images\n'
            images.forEach(attachment => {
                const githubLink = getAttachmentGithubURL(attachment);
                description += getAttachmentPostMessage(attachment, {
                    uploadedURL: attachmentURLs.get(attachment.name) || attachment.url,
                    githubLink
                });
            })
        }

        if (others.length) {
            description += '### Other files\n'
            others.forEach(attachment => {
                const githubLink = getAttachmentGithubURL(attachment);
                description += getAttachmentPostMessage(attachment, {
                    uploadedURL: attachmentURLs.get(attachment.name) || attachment.url,
                    githubLink
                });
            })
        }

        return description;
    }

    public static createAttachmentViewerMessages(viewerAttachments: Attachment[], uploadMessage: Message | null): string[] {
        const attachmentURLs = new Map();
        if (uploadMessage) {
            uploadMessage.attachments.forEach(attachment => {
                attachmentURLs.set(attachment.name, attachment.url);
            });
        }

        let messages: string[] = [];
        viewerAttachments.forEach((attachment, i)=>{
            const message = (i === 0 ? "### Attachment Embeds\n" : "") + (attachmentURLs.get(attachment.name) || attachment.url) + (attachment.description.length ? ` - ${attachment.description}` : '') + '\n';
            const split = splitIntoChunks(message, 2000);
            messages.push(...split);
        });

        return messages;
    }


    public static createInitialMessage(guildHolder: GuildHolder, entryData: ArchiveEntryData, entryPathPart: string): string{
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

        const post = postToMarkdown(entryData.records, entryData.styles, guildHolder.getSchemaStyles());
     
        const transformed = transformOutputWithReferencesForDiscord(post, entryData.references); 
        content.push('\n' + transformed);

        const authorsWithReasons = entryData.authors.filter(author => author.reason);
        if (authorsWithReasons.length > 0) {
            content.push(`\n## Acknowledgements`);
            authorsWithReasons.forEach(author => {
                content.push(`\n- ${getAuthorsString([author])}: ${transformOutputWithReferencesForDiscord(author.reason || '', entryData.author_references)}`);
            });
        }

        const githubURL = guildHolder.getConfigManager().getConfig(GuildConfigs.GITHUB_REPO_URL);
        // parse the URL to get the repo name and owner
        const { owner, project } = getGithubOwnerAndProject(githubURL);

        const submissionThreadID = entryData.id;
        // const submissionsForumID = guildHolder.getConfigManager().getConfig(GuildConfigs.SUBMISSION_CHANNEL_ID);

        const submissionURL = `https://discord.com/channels/${guildHolder.getGuild().id}/${submissionThreadID}`;

        const gitURL = `https://github.com/${owner}/${project}/tree/${guildHolder.getRepositoryManager().getBranchName()}/${entryPathPart}#readme`;
        content.push(`\n\n[Submission Thread](${submissionURL})`);
        content.push(`\n[Github](${gitURL})`);

        const websiteURL = guildHolder.getConfigManager().getConfig(GuildConfigs.WEBSITE_URL);
        if (websiteURL) {
            const postURLObj = new URL(websiteURL);
            const pathAdded = `/archives/${buildEntrySlug(entryData.code, entryData.name)}`;
            postURLObj.pathname = postURLObj.pathname.endsWith('/') ? postURLObj.pathname.slice(0, -1) + pathAdded : postURLObj.pathname + pathAdded;
            content.push(` | [Website](${postURLObj.href})`);
        }
        content.push(`\nArchived on <t:${Math.floor(entryData.archivedAt / 1000)}:F>`);
        if (entryData.updatedAt !== entryData.archivedAt) {
            content.push(`\nLast updated on <t:${Math.floor(entryData.updatedAt / 1000)}:F>`);
        }
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
