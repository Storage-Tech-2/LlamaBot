export type VersionData = {
    minecraftVersion: string,
    dataVersion: number,
    usesNetty: boolean,
    majorVersion: string,
    releaseType: string,
}

export class MCMeta {

    private chachedVersionData: VersionData[] | null = null;

    constructor() {

    }

    public async fetchVersionData() {
        const response = await fetch('https://raw.githubusercontent.com/PrismarineJS/minecraft-data/refs/heads/master/data/pc/common/protocolVersions.json');
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

        const foundVersion = this.chachedVersionData.find(version => version.dataVersion === dataVersion);

        if (foundVersion) {
            return foundVersion;
        } else {
            return null;
        }
    }

}