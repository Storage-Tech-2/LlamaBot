import simpleGit, { SimpleGit } from "simple-git";
import { GuildHolder } from "../GuildHolder";
import fs from "fs/promises";
import { ConfigManager } from "../config/ConfigManager";
import Path from "path";
import { ForumChannel, Snowflake } from "discord.js";
import { ArchiveChannel, RepositoryConfigs } from "./RepositoryConfigs";
import { escapeString } from "../utils/Util";
import { ArchiveEntry } from "./ArchiveEntry";


export class RepositoryManager {
    private folderPath: string;
    private guildHolder: GuildHolder;
    private git?: SimpleGit;
    private configManager: ConfigManager;

    constructor(guildHolder: GuildHolder, folderPath: string) {
        this.guildHolder = guildHolder;
        this.folderPath = folderPath;
        this.configManager = new ConfigManager(Path.join(folderPath, 'config.json'));
    }

    async init() {
        // try to access the folder, create it if it doesn't exist
        if (!await fs.access(this.folderPath).then(() => true).catch(() => false)) {
            await fs.mkdir(this.folderPath, { recursive: true });
        }
        this.git = simpleGit(this.folderPath);
        await this.git.init();

        await this.git.addConfig('user.name', 'Llamabot Archive Bot');
        await this.git.addConfig('user.email', 'llama@soontech.org');

        // Load the config manager
        await this.configManager.loadConfig();
    }

    public getChannels() {
        return this.configManager.getConfig(RepositoryConfigs.ARCHIVE_CHANNELS);
    }

    async setupArchives(channels: ForumChannel[], codeMap: Map<Snowflake, string>) {
        if (!this.git) {
            throw new Error("Git not initialized");
        }

        const reMapped: ArchiveChannel[] = [];
        for (const channel of channels.values()) {
            await channel.fetch();
            reMapped.push({
                id: channel.id,
                name: channel.name,
                code: codeMap.get(channel.id) || '',
                path: `Archive/${escapeString(codeMap.get(channel.id) || '')}_${escapeString(channel.name) || ''}`,
                description: channel.topic || ''
            });
        }


        const existingChannels = this.getChannels();
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
            await this.git.rm([channelPath]);
            await this.git.commit(`Removed channel ${channel.name} (${channel.id})`);
        }

        // Then, add new channels
        for (const channel of newChannels) {
            const channelPath = Path.join(this.folderPath, channel.path);

            await fs.mkdir(channelPath, { recursive: true });
            // Commit the new channel
            await this.git.add(channelPath);
            await this.git.commit(`Added channel ${channel.name} (${channel.id})`);
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
            const files = await fs.readdir(newPath);
            for (const folder of files) {
                // Check if the file is a directory
                const filePath = Path.join(newPath, folder);
                const stat = await fs.stat(filePath);
                if (!stat.isDirectory()) {
                    continue;
                }

                const nameWithoutCode = folder.replace(new RegExp(`^${escapeString(oldChannel.code)}`), '');
                const newName = `${escapeString(channel.code)}${nameWithoutCode}`;
                const newFilePath = Path.join(newPath, newName);
                // Rename
                if (filePath !== newFilePath) {
                    await this.git.mv(filePath, newFilePath);
                }

                // Load entry
                const entry = await ArchiveEntry.fromFolder(newFilePath);
                entry.getData().code = channel.code + entry.getData().code.replace(new RegExp(`^${oldChannel.code}`), '');
                
                // Rename attachment files
                for (const attachment of entry.getData().attachments) {
                    const oldName = attachment.name;
                    const newAttachmentName = `${channel.code}${attachment.name.replace(new RegExp(`^${oldChannel.code}`), '')}`;
                    if (oldName !== newAttachmentName) {
                        const oldAttachmentPath = Path.join(newFilePath, oldName);
                        const newAttachmentPath = Path.join(newFilePath, newAttachmentName);
                        await this.git.mv(oldAttachmentPath, newAttachmentPath);
                        attachment.name = newAttachmentName;
                    }
                }

                // Save the entry
                await entry.save();
            }

            // Commit the changes
            let msg;
            if (oldChannel.code !== channel.code) {
                msg = `Changed code for channel ${oldChannel.name} from ${oldChannel.code} to ${channel.code} (${channel.id})`;
            } else if (oldChannel.name !== channel.name) {
                msg = `Renamed channel ${oldChannel.name} to ${channel.name} (${channel.id})`;
            } else {
                msg = `Updated channel ${oldChannel.name} (${channel.id})`;
            }
            await this.git.commit(msg);
        }

        // Finally, save the new config
        this.configManager.setConfig(RepositoryConfigs.ARCHIVE_CHANNELS, reMapped);
        await this.save();

        // Add config if it doesn't exist
        await this.git.add(Path.join(this.folderPath, 'config.json'));
        await this.git.commit('Updated repository configuration');
    }

    async save() {
        await this.configManager.saveConfig();
    }

    public getConfigManager(): ConfigManager {
        return this.configManager;
    }

}