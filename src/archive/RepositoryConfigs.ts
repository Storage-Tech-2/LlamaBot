import { Config } from "../config/ConfigManager";

export type ArchiveChannel = {
    id: string;
    name: string;
    description: string;
    path: string;
    code: string;
}


export const RepositoryConfigs = {
    /**
     * Channel categories for the archive.
     */
    ARCHIVE_CHANNELS: new Config<ArchiveChannel[]>("archiveChannels", []),
}