import { TemporaryCache } from "../archive/TemporaryCache.js";
import fs from "fs/promises";
import { safeWorkspacePath } from "../utils/SafePath.js";

export class AliasManager {

    private aliasesCache: TemporaryCache<Map<string, string>>;
    constructor(private filePath: string) {
        this.filePath = safeWorkspacePath(filePath);
        this.aliasesCache = new TemporaryCache<Map<string, string>>(
            10 * 60 * 1000,
            () => this.loadAliasesFromFile()
        );
    }

    private async loadAliasesFromFile(): Promise<Map<string, string>> {
        const aliases = new Map<string, string>();
        try {
            const data = JSON.parse(await fs.readFile(this.filePath, 'utf-8'));
            for (const [alias, actual] of Object.entries(data)) {
                aliases.set(alias, actual as string);
            }
        } catch (error) {
            return aliases;
        }
        return aliases;
    }

    public async getAliases(): Promise<Map<string, string>> {
        return this.aliasesCache.get();
    }

    private async saveAliasesToFile(aliases: Map<string, string>): Promise<void> {
        const obj: Record<string, string> = {};
        for (const [alias, actual] of aliases.entries()) {
            obj[alias] = actual;
        }
        await fs.writeFile(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
    }

    public async setAlias(alias: string, actual: string): Promise<void> {
        const aliases = await this.getAliases();
        if (actual.length === 0) {
            aliases.delete(alias);
        } else {
            aliases.set(alias, actual);
        }
        await this.saveAliasesToFile(aliases);
        this.aliasesCache.set(aliases);
    }


}
