import { Config } from "../config/ConfigManager.js";

export type ArchiveChannelReference = {
    id: string;
    name: string;
    code: string;
    category: string;
    description: string;
    path: string;
    availableTags: string[];
}


export const RepositoryConfigs = {
    /**
     * Channel categories for the archive.
     */
    ARCHIVE_CHANNELS: new Config<ArchiveChannelReference[]>("archiveChannels", []),
}