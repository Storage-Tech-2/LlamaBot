import { GuildHolder } from "../GuildHolder.js";
import fs from "fs/promises";
import { ConfigManager } from "../config/ConfigManager.js";
import Path from "path";
import { ChannelType, ForumChannel, MessageFlags } from "discord.js";
import { ArchiveChannelReference, RepositoryConfigs } from "./RepositoryConfigs.js";
import { areObjectsIdentical, deepClone, escapeString, generateCommitMessage, getCodeAndDescriptionFromTopic, getFileKey, getGithubOwnerAndProject } from "../utils/Util.js";
import { ArchiveEntry, ArchiveEntryData } from "./ArchiveEntry.js";
import { Submission } from "../submissions/Submission.js";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs.js";
import { ArchiveChannel, ArchiveEntryReference } from "./ArchiveChannel.js";
import { Lock } from "../utils/Lock.js";
import { PostEmbed } from "../embed/PostEmbed.js";
import { GuildConfigs } from "../config/GuildConfigs.js";
import {simpleGit, SimpleGit } from "simple-git";


export class RepositoryManager {
    private folderPath: string;
    private git?: SimpleGit;
    private configManager: ConfigManager;
    private lock: Lock = new Lock();
    private guildHolder: GuildHolder;
    constructor(guildHolder: GuildHolder, folderPath: string) {
        this.guildHolder = guildHolder;
        this.folderPath = folderPath;
        this.configManager = new ConfigManager(Path.join(folderPath, 'config.json'));
    }

    async init() {
        await this.lock.acquire();
        // try to access the folder, create it if it doesn't exist
        if (!await fs.access(this.folderPath).then(() => true).catch(() => false)) {
            await fs.mkdir(this.folderPath, { recursive: true });
        }
        this.git = simpleGit(this.folderPath)
            .init()
            .addConfig('user.name', 'llamabot-archiver[bot]')
            .addConfig('user.email', '217070326+llamabot-archiver[bot]@users.noreply.github.com')
            .addConfig('pull.rebase', 'false')


        // check if gitignore exists, create it if it doesn't
        const gitignorePath = Path.join(this.folderPath, '.gitignore');
        if (!await fs.access(gitignorePath).then(() => true).catch(() =>
            false)) {
            await fs.writeFile(gitignorePath, '.DS_Store\n', 'utf-8');
            await this.git.add('.gitignore');
            await this.git.commit('Initial commit: add .gitignore');
        }


        // Load the config manager
        await this.configManager.loadConfig();

        // try pull
        try {
            await this.pull();
        } catch (e: any) {
            console.error("Error pulling from remote:", e.message);
        }

        try {
            await this.push();
        } catch (e: any) {
            console.error("Error pushing to remote:", e.message);
        }

        await this.lock.release();
    }

    async pull() {
        if (!this.git) {
            throw new Error("Git not initialized");
        }
        await this.updateRemote();
        const branchName = await this.git.branchLocal().then(branch => branch.current);
        await this.git.pull('origin', branchName);
    }

    async updateRemote() {
        if (!this.git) {
            throw new Error("Git not initialized");
        }

        const remoteURL = this.guildHolder.getConfigManager().getConfig(GuildConfigs.GITHUB_REPO_URL);
        if (!remoteURL) {
            throw new Error("GitHub repository URL not set in guild configuration");
        }

        const { owner, project } = getGithubOwnerAndProject(remoteURL);
        if (!owner || !project) {
            throw new Error("Invalid GitHub repository URL");
        }

        const token = await this.guildHolder.getBot().getGithubInstallationToken(owner);


        const remotes = await this.git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        if (origin) {
            await this.git.removeRemote('origin');
        }

        await this.git.addRemote('origin', `https://x-access-token:${token}@github.com/${owner}/${project}.git`);
    }

    public getChannelReferences() {
        return this.configManager.getConfig(RepositoryConfigs.ARCHIVE_CHANNELS);
    }

    async setupArchives(channels: ForumChannel[]) {
        if (!this.git) {
            throw new Error("Git not initialized");
        }
        await this.lock.acquire();

        const reMapped: ArchiveChannelReference[] = [];
        for (const channel of channels.values()) {
            await channel.fetch();
            const { code, description } = getCodeAndDescriptionFromTopic(channel.topic || '');
            if (!code) {
                throw new Error(`Channel ${channel.name} (${channel.id}) does not have a valid code in the topic.`);
            }
            reMapped.push({
                id: channel.id,
                name: channel.name,
                code,
                path: `Archive/${code}_${escapeString(channel.name) || ''}`,
                description: description || 'No description'
            });
        }


        const existingChannels = this.getChannelReferences();
        const newChannels = reMapped.filter(c => !existingChannels.some(ec => ec.id === c.id));
        const removedChannels = existingChannels.filter(ec => !reMapped.some(c => c.id === ec.id));
        const modifiedChannels = reMapped.filter(c => {
            const existing = existingChannels.find(ec => ec.id === c.id);
            return existing && (existing.name !== c.name || existing.description !== c.description || existing.code !== c.code);
        });

        // First, remove any channels that no longer exist
        for (const channel of removedChannels) {
            const channelPath = Path.join(this.folderPath, channel.path);
            // Commit the removal
            await fs.rm(channelPath, { recursive: true, force: true });
            await this.git.commit(`Removed channel ${channel.name} (${channel.code})`);
        }

        // Then, add new channels
        for (const channel of newChannels) {
            const channelPath = Path.join(this.folderPath, channel.path);

            await fs.mkdir(channelPath, { recursive: true });

            // make new channel
            const newChannel = ArchiveChannel.newFromReference(channel, channelPath);
            await newChannel.save();


            // Commit the new channel
            await this.git.add(channelPath);
            await this.git.commit(`Added channel ${channel.name} (${channel.code})`);
        }

        // Finally, update modified channels
        for (const channel of modifiedChannels) {
            const oldChannel = existingChannels.find(ec => ec.id === channel.id);
            if (!oldChannel) continue;
            const oldPath = Path.join(this.folderPath, oldChannel.path);
            const newPath = Path.join(this.folderPath, channel.path);

            // Rename the folder if the path has changed
            if (oldPath !== newPath) {
                await this.git.mv(oldPath, newPath);
            }

            // check each post. Iterate through the files in the new path
            const channelInstance = await ArchiveChannel.fromFolder(newPath);
            if (!channelInstance) {
                throw new Error(`Channel ${channel.name} (${channel.id}) not found in memory`);
            }

            const entries = channelInstance.getData().entries;
            const newEntries: ArchiveEntryReference[] = [];
            for (const oldEntryRef of entries) {
                // Check if the file is a directory
                const newEntryRef: ArchiveEntryReference = {
                    ...oldEntryRef
                };

                newEntryRef.code = channel.code + oldEntryRef.code.replace(new RegExp(`^${oldChannel.code}`), '');
                newEntryRef.path = `${newEntryRef.code}_${escapeString(oldEntryRef.name || '')}`;

                const oldFolderPath = Path.join(newPath, oldEntryRef.path);
                const newFolderPath = Path.join(newPath, newEntryRef.path);
                // Rename
                if (oldFolderPath !== newFolderPath) {
                    await this.git.mv(oldFolderPath, newFolderPath);
                }

                // Load entry
                const entry = await ArchiveEntry.fromFolder(newFolderPath);
                entry.getData().code = newEntryRef.code;

                // Rename attachment files
                for (const attachment of entry.getData().attachments) {
                    const newName = attachment.name.replace(new RegExp(`^${oldEntryRef.code}`), newEntryRef.code);
                    attachment.name = newName;

                    const oldPath = attachment.path || '';
                    // split the path to get the file name
                    const oldPathParts = oldPath.split('/');
                    const oldFileName = oldPathParts.pop() || '';
                    oldPathParts.push(oldFileName.replace(new RegExp(`^${oldEntryRef.code}`), newEntryRef.code));
                    const newPath = oldPathParts.join("/");
                    if (oldPath !== newPath) {
                        const fullOldPath = Path.join(newFolderPath, oldPath);
                        const fullNewPath = Path.join(newFolderPath, newPath);
                        await this.git.mv(fullOldPath, fullNewPath);
                        attachment.path = newPath;
                    }
                }

                // Save the entry
                await entry.save();
                newEntries.push(newEntryRef);
            }

            channelInstance.getData().name = channel.name;
            channelInstance.getData().description = channel.description;
            channelInstance.getData().code = channel.code;
            channelInstance.getData().entries = newEntries;
            await channelInstance.save();

            // Commit the changes
            let msg;
            if (oldChannel.code !== channel.code) {
                msg = `Changed code for channel ${oldChannel.name} from ${oldChannel.code} to ${channel.code}`;
            } else if (oldChannel.name !== channel.name) {
                msg = `Renamed channel ${oldChannel.name} to ${channel.name} (${channel.code})`;
            } else {
                msg = `Updated channel ${oldChannel.name} (${channel.code})`;
            }
            await this.git.commit(msg);
        }

        // Finally, save the new config
        this.configManager.setConfig(RepositoryConfigs.ARCHIVE_CHANNELS, reMapped);
        await this.save();

        // Add config if it doesn't exist
        await this.git.add(Path.join(this.folderPath, 'config.json'));
        await this.git.commit('Updated repository configuration');
        try {
            await this.push();
        } catch (e: any) {
            console.error("Error pushing to remote:", e.message);
        }
        await this.lock.release();
    }

    async findEntryBySubmissionId(submissionId: string): Promise<null | {
        channelRef: ArchiveChannelReference,
        channel: ArchiveChannel,
        entry: ArchiveEntry,
        entryRef: ArchiveEntryReference,
        entryIndex: number
    }> {
        const channelReferences = this.getChannelReferences();
        for (const channelRef of channelReferences) {
            const channelPath = Path.join(this.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            const entries = archiveChannel.getData().entries;
            const entryIndex = entries.findIndex(e => e.id === submissionId);
            if (entryIndex !== -1) {
                const entryRef = entries[entryIndex];
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);
                return {
                    channelRef,
                    channel: archiveChannel,
                    entry,
                    entryRef,
                    entryIndex
                };
            }
        }

        return null;
    }

    async addOrUpdateEntry(submission: Submission): Promise<{ oldEntryData?: ArchiveEntryData, newEntryData: ArchiveEntryData }> {

        if (!this.git) {
            throw new Error("Git not initialized");
        }
        await this.lock.acquire();
        try {
            const archiveChannelId = submission.getConfigManager().getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
            if (!archiveChannelId) {
                throw new Error("Submission does not have an archive channel set");
            }


            const archiveChannelRef = this.getChannelReferences().find(c => c.id === archiveChannelId);
            if (!archiveChannelRef) {
                throw new Error("Archive channel reference not found");
            }
            const channelPath = Path.join(this.folderPath, archiveChannelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);


            // Find old entry if it exists
            const existing = await this.findEntryBySubmissionId(submission.getId());
            const isSameChannel = existing && existing.channelRef.id === archiveChannelId;
            const newCode = isSameChannel ? existing.entryRef.code : (archiveChannel.getData().code + (++archiveChannel.getData().currentCodeId).toString().padStart(3, '0'));



            const revisionReference = submission.getRevisionsManager().getCurrentRevision();
            if (!revisionReference) {
                throw new Error("Submission does not have a current revision");
            }
            const revision = await submission.getRevisionsManager().getRevisionById(revisionReference.id);
            if (!revision) {
                throw new Error("Submission revision not found");
            }

            const submissionChannel = await submission.getSubmissionChannel();
            const config = submission.getConfigManager();

            config.setConfig(SubmissionConfigs.NAME, submissionChannel.name);

            const name = config.getConfig(SubmissionConfigs.NAME);
            const authors = config.getConfig(SubmissionConfigs.AUTHORS) || [];
            const endorsers = config.getConfig(SubmissionConfigs.ENDORSERS);
            const tags = config.getConfig(SubmissionConfigs.TAGS) || [];
            const images = submission.getConfigManager().getConfig(SubmissionConfigs.IMAGES) || [];
            const attachments = submission.getConfigManager().getConfig(SubmissionConfigs.ATTACHMENTS) || [];
            const description = revision.description || '';
            const features = revision.features || [];
            const considerations = revision.considerations || [];
            const notes = revision.notes || '';



            const entryData: ArchiveEntryData = deepClone({
                id: submission.getId(),
                name,
                code: newCode,
                authors,
                endorsers,
                tags,
                images,
                attachments,
                description,
                features,
                considerations,
                notes,
                timestamp: Date.now(),
                post: undefined, // post will be set later
            });

            const entryRef: ArchiveEntryReference = {
                id: submission.getId(),
                name: entryData.name,
                code: entryData.code,
                timestamp: entryData.timestamp,
                path: `${entryData.code}_${escapeString(entryData.name) || ''}`,
            }


            const entryFolder = Path.join(channelPath, entryRef.path);
            if (existing) {
                const existingFolder = Path.join(existing.channel.getFolderPath(), existing.entryRef.path);
                if (existingFolder !== entryFolder) {
                    // If the folder is different, we need to rename the old folder
                    await this.git.mv(existingFolder, entryFolder);
                }

                if (!isSameChannel) {
                    // If the channel is different, we need to remove the old entry from the old channel
                    existing.channel.getData().entries.splice(existing.entryIndex, 1);
                    await existing.channel.save();

                    // Also remove old discord post if it exists
                    const post = existing.entry.getData().post;
                    if (post) {
                        const publishForumId = post.forumId;
                        const publishForum = await submission.getGuildHolder().getGuild().channels.fetch(publishForumId);
                        if (publishForum && publishForum.type === ChannelType.GuildForum) {
                            const thread = await publishForum.threads.fetch(post.threadId);
                            if (thread) {
                                await thread.delete('Entry moved to a different channel');
                            }
                        }
                    }
                } else {
                    entryData.post = existing.entry.getData().post;
                }
            }

            await fs.mkdir(entryFolder, { recursive: true });
            const entry = new ArchiveEntry(entryData, entryFolder);

            const imageFolder = Path.join(entryFolder, 'images');
            const attachmentFolder = Path.join(entryFolder, 'attachments');

            // remove all images and attachments that exist in the folder.
            await fs.mkdir(imageFolder, { recursive: true });
            await fs.mkdir(attachmentFolder, { recursive: true });

            for (const file of await fs.readdir(imageFolder)) {
                const filePath = Path.join(imageFolder, file);
                const stat = await fs.lstat(filePath);
                if (stat.isFile()) {
                    await fs.unlink(filePath);
                }
            }
            for (const file of await fs.readdir(attachmentFolder)) {
                const filePath = Path.join(attachmentFolder, file);
                const stat = await fs.lstat(filePath);
                if (stat.isFile()) {
                    await fs.unlink(filePath);
                }
            }

            // Copy over all attachments and images to the new folder
            for (const image of entryData.images) {
                const sourcePath = Path.join(submission.getProcessedImagesFolder(), getFileKey(image, 'png'));
                const dest = image.name.split('.');
                if (dest.length > 1) {
                    dest.pop();
                }
                const destKeyOrig = escapeString(dest.join(''));
                let destKey = destKeyOrig;

                // Check for duplicate file names
                for (let i = 1; i < 15; i++) {
                    if (await fs.access(Path.join(imageFolder, `${destKey}.png`)).then(() => true).catch(() => false)) {
                        destKey = `${destKeyOrig}_${i}`;
                    }
                }

                const destPath = Path.join(imageFolder, `${destKey}.png`);
                await fs.copyFile(sourcePath, destPath);
                image.path = `images/${destKey}.png`;
                image.name = destKey + '.png'; // Update the name to the new key
            }

            for (const attachment of entryData.attachments) {
                const dest = attachment.name.split('.');
                let ext = dest.length > 1 ? escapeString(dest.pop() || '') : '';
                if (!attachment.canDownload) {
                    ext = 'url';
                }

                const destKeyOrig = entryData.code + '_' + escapeString(dest.join(''));
                let destKey = destKeyOrig;
                for (let i = 1; i < 15; i++) {
                    if (await fs.access(Path.join(attachmentFolder, `${destKey}${ext ? '.' + ext : ''}`)).then(() => true).catch(() => false)) {
                        destKey = `${destKeyOrig}_${i}`;
                    }
                }

                const newKey = `${destKey}${ext ? '.' + ext : ''}`;
                const sourcePath = Path.join(submission.getAttachmentFolder(), getFileKey(attachment));
                const destPath = Path.join(attachmentFolder, newKey);
                attachment.path = `attachments/${newKey}`;
                attachment.name = destKey; // Update the name to the new key
                if (!attachment.canDownload) {
                    await fs.writeFile(destPath, attachment.url || '', 'utf-8');
                } else {
                    await fs.copyFile(sourcePath, destPath);
                }
            }

            if (existing && isSameChannel) {
                const dt = deepClone(existing.entry.getData());
                dt.timestamp = entryData.timestamp;
                // compare the data
                if (areObjectsIdentical(dt, entryData)) {
                    throw new Error("No changes detected in the entry data");
                }

                archiveChannel.getData().entries[existing.entryIndex] = entryRef;
            } else {
                // New entry
                archiveChannel.getData().entries.push(entryRef);
            }

            const publishChannelId = config.getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
            const publishChannel = await submission.getGuildHolder().getGuild().channels.fetch(publishChannelId);
            if (!publishChannel || publishChannel.type !== ChannelType.GuildForum) {
                throw new Error('Publish channel not found or is not a forum channel');
            }

            let thread;
            if (entryData.post) {
                thread = await publishChannel.threads.fetch(entryData.post.threadId);
            } else {
                entryData.post = {
                    forumId: publishChannelId,
                    threadId: '',
                    messageId: '',
                    threadURL: '',
                }
            }

            const path = `${archiveChannelRef.path}/${entryRef.path}`;
            let message = await PostEmbed.createInitialMessage(submission, submissionChannel.url, '', path, entryData);
            if (!thread) {
                thread = await publishChannel.threads.create({
                    message: {
                        content: `Pending...`,
                        files: message.files,
                        flags: [MessageFlags.SuppressEmbeds]
                    },
                    name: entryData.code + ' ' + entryData.name,
                    appliedTags: entryData.tags.map(tag => tag.id),
                })
                entryData.post.threadId = thread.id;
                entryData.post.threadURL = thread.url;
            } else {
                await thread.setAppliedTags(entryData.tags.map(tag => tag.id));
            }

            let attachmentMessageInstance;
            if (entryData.post.attachmentMessageId) {
                attachmentMessageInstance = await thread.messages.fetch(entryData.post.attachmentMessageId);
            }

            if (!attachmentMessageInstance) {
                attachmentMessageInstance = await thread.send({
                    content: `pending...`,
                    flags: [MessageFlags.SuppressEmbeds]
                });
                entryData.post.attachmentMessageId = attachmentMessageInstance.id;
            }

            await entry.save();
            await archiveChannel.save();

            await this.git.add(entryFolder);
            await this.git.add(channelPath); // to update currentCodeId and entries

            if (existing) {

                await this.git.commit(generateCommitMessage(existing.entry.getData(), entryData));
            } else {
                await this.git.commit(`Added entry ${entryData.name} (${entryData.code}) to channel ${archiveChannel.getData().name} (${archiveChannel.getData().code})`);
            }

            // Now post to discord

            // First, upload attachments

            const commitID = await this.git.revparse('HEAD');

            const attachmentUpload = await PostEmbed.createAttachmentUpload(submission, submissionChannel.url, commitID, entryFolder, entryData);
            const uploadMessage = await submissionChannel.send({
                content: attachmentUpload.content,
                files: attachmentUpload.files,
            });

            message = await PostEmbed.createInitialMessage(submission, submissionChannel.url, commitID, path, entryData);
            const attachmentMessage = await PostEmbed.createAttachmentMessage(submission, submissionChannel.url, commitID, path, entryData, uploadMessage);

            if (entryData.name !== thread.name) {
                await thread.edit({
                    name: entryData.code + ' ' + entryData.name
                })
            }

            const initialMessage = await thread.fetchStarterMessage();
            if (!initialMessage) {
                throw new Error('Initial message not found in thread');
            }

            await initialMessage.edit({
                content: message.content,
                flags: [MessageFlags.SuppressEmbeds],
            });


            await attachmentMessageInstance.edit({
                content: attachmentMessage.content,
                flags: [MessageFlags.SuppressEmbeds]
            });

            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }
            await this.lock.release();
            return {
                oldEntryData: existing ? existing.entry.getData() : undefined,
                newEntryData: entry.getData()
            }
        } catch (e) {
            await this.lock.release();
            throw e;
        }
    }

    async retractEntry(submission: Submission, reason: string): Promise<ArchiveEntryData> {
        if (!this.git) {
            throw new Error("Git not initialized");
        }
        await this.lock.acquire();
        try {
            // Find archived entry in all channels
            const found = await this.findEntryBySubmissionId(submission.getId());
            if (!found) {
                throw new Error(`Submission ${submission.getId()} not found in any archive channel`);
            }
            const { channel: foundChannel, entry: foundEntry, entryIndex: foundEntryIndex } = found;
            const entryData = foundEntry.getData();
            const entryPath = foundEntry.getFolderPath();

            // Remove all files inside the entry folder
            const files = [];
            const stack = [entryPath];
            while (stack.length > 0) {
                const currentPath = stack.pop();
                if (!currentPath) continue;
                const entries = await fs.readdir(currentPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name === '.DS_Store') {
                        // delete .DS_Store files
                        await fs.unlink(Path.join(currentPath, entry.name));
                        continue; // Skip .DS_Store files
                    }
                    const fullPath = Path.join(currentPath, entry.name);
                    if (entry.isDirectory()) {
                        stack.push(fullPath);
                    } else {
                        files.push(fullPath);
                    }
                }
            }

            await this.git.rm(files);
            
            foundChannel.getData().entries.splice(foundEntryIndex, 1);
            await foundChannel.save();

            // Commit the removal
            await this.git.commit(`Retracted entry ${entryData.name} (${entryData.code}) from channel ${foundChannel.getData().name} (${foundChannel.getData().code})\nReason: ${reason || 'No reason provided'}`);

            // Now post to discord
            if (!entryData.post) {
                throw new Error('Entry does not have a post or thread ID');
            }
            const publishForumId = entryData.post.forumId;
            const publishForum = await submission.getGuildHolder().getGuild().channels.fetch(publishForumId);
            if (!publishForum || publishForum.type !== ChannelType.GuildForum) {
                throw new Error('Publish forum not found or is not a forum channel');
            }
            const thread = await publishForum.threads.fetch(entryData.post.threadId);
            if (!thread) {
                throw new Error('Thread not found in publish forum');
            }

            await thread.delete(reason || 'No reason provided');

            // Remove post
            submission.getConfigManager().setConfig(SubmissionConfigs.POST, null);
            await submission.save();
            try {
                await this.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }

            this.lock.release();

            return entryData;
        } catch (e) {
            this.lock.release();
            throw e;
        }
    }


    async push() {
        if (!this.git) {
            return;
        }
        await this.updateRemote();

        const branchName = await this.git.branchLocal().then(branch => branch.current);
        await this.git.push(['-u', 'origin', branchName]);
    }

    async save() {
        await this.configManager.saveConfig();
    }

    public getConfigManager(): ConfigManager {
        return this.configManager;
    }

}

