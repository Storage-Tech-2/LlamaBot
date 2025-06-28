export type VersionData = {
    id: string;
    name: string;
    release_target: string | null;
    type: string;
    stable: boolean;
    data_version: number;
    protocol_version: number;
    data_pack_version: number;
    resource_pack_version: number;
    build_time: string;
    release_time: string;
    sha1: string;
}

export class MCMeta {

    private chachedVersionData: VersionData[] | null = null;

    constructor() {

    }

    public async fetchVersionData() {
        // https://raw.githubusercontent.com/misode/mcmeta/refs/heads/summary/versions/data.json
        const response = await fetch('https://raw.githubusercontent.com/misode/mcmeta/refs/heads/summary/versions/data.json');
        if (!response.ok) {
            throw new Error(`Failed to fetch version data: ${response.statusText}`);
        }
        const data = await response.json() as VersionData[];
        this.chachedVersionData = data;
        return data;
    }


    public getByDataVersion(dataVersion: number): VersionData | null {
        if (!this.chachedVersionData) {
            throw new Error('Version data not fetched. Call fetchVersionData() first.');
        }

        const foundVersion = this.chachedVersionData.find(version => version.data_version === dataVersion);

        if (foundVersion) {
            return foundVersion;
        } else {
            return null;
        }
    }

}