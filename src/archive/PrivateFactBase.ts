import Path from "path";
import fs from "fs/promises";
import { EmbeddingsEntry, base64ToInt8Array, makeHNSWIndex, EmbeddingsSearchResult, loadHNSWIndex } from "../llm/EmbeddingUtils.js";
import { TemporaryCache } from "./TemporaryCache.js";
import { HierarchicalNSW } from "hnswlib-node";

export type Citation = {
    number: number;
    question: string;
    answer: string;
    timestamp: number;
    message_ids: string[];
}

export type FactSheet = {
    index: number;
    cluster_id: number;
    text: string;
    cited: Array<Citation>;
}

export class PrivateFactBase {
    private isEnabled: boolean = false;
    private hnswIndexCache: TemporaryCache<HierarchicalNSW | null>;

    constructor(private folderPath: string) {
        this.hnswIndexCache = new TemporaryCache<HierarchicalNSW | null>(5 * 60 * 1000, async () => {
            return await loadHNSWIndex(this.getEmbeddingsIndexPath()).catch(() => null);
        });

        this.init();
    }

    private async init() {
        // first, check if embeddings file exists
        const embeddings = await this.getEmbeddings();
        if (!embeddings || embeddings.length === 0) {
            this.isEnabled = false;
            return;
        }

        // next, check if index file exists, if it doesnt make it
        try {
            await fs.access(this.getEmbeddingsIndexPath());
        } catch (e) {
            await this.buildEmbeddingsIndex();
        }

        this.isEnabled = true;
    }

    getEmbeddingsPath(): string {
        return Path.join(this.folderPath, 'embeddings.json');
    }

    getEmbeddingsIndexPath(): string {
        return Path.join(this.folderPath, 'hnsw.idx');
    }

    async getEmbeddings(): Promise<EmbeddingsEntry[]> {
        const embeddingsPath = this.getEmbeddingsPath();
        try {
            const data = await fs.readFile(embeddingsPath, 'utf-8');
            const embeddings: EmbeddingsEntry[] = JSON.parse(data);
            return embeddings;
        } catch (e) {
            return [];
        }
    }

    async buildEmbeddingsIndex(): Promise<void> {
        const embeddings = await this.getEmbeddings();
        const embeddingVectors: Int8Array[] = embeddings.map(entry => {
            return base64ToInt8Array(entry.embedding);
        });
        const lookupFile = embeddings.map(entry => entry.identifier);
        await fs.writeFile(Path.join(this.folderPath, 'embeddings_lookup.json'), JSON.stringify(lookupFile, null, 2), 'utf-8');
        await makeHNSWIndex(embeddingVectors, this.getEmbeddingsIndexPath());
        this.hnswIndexCache.clear();
    }

    async getLookupList(): Promise<string[]> {
        const lookupPath = Path.join(this.folderPath, 'embeddings_lookup.json');
        try {
            const data = await fs.readFile(lookupPath, 'utf-8');
            const lookupList: string[] = JSON.parse(data);
            return lookupList;
        } catch (e) {
            return [];
        }
    }

    async getClosest(embedding: Int8Array, numNeighbors: number): Promise<EmbeddingsSearchResult[]> {
        if (!this.isEnabled) {
            return [];
        }

        const [index, lookupList] = await Promise.all([
            this.hnswIndexCache.get(),
            this.getLookupList()
        ]);
        if (!index) {
            return [];
        }
        const results = index.searchKnn(Array.from(embedding), numNeighbors);
        const closestEntries: EmbeddingsSearchResult[] = [];
        for (let i = 0; i < results.neighbors.length; i++) {
            const neighborIdx = results.neighbors[i];
            if (neighborIdx < 0 || neighborIdx >= lookupList.length) {
                continue;
            }
            closestEntries.push({
                identifier: lookupList[neighborIdx],
                distance: results.distances[i],
            });
        }

        // sort in ascending order of distance
        closestEntries.sort((a, b) => a.distance - b.distance);

        return closestEntries;
    }

    async getFact(identifier: string): Promise<FactSheet | null> {
        if (!this.isEnabled) {
            return null;
        }
        const path = Path.join(this.folderPath, 'facts', `${identifier}.json`);
        try {
            const data = await fs.readFile(path, 'utf-8');
            return JSON.parse(data) as FactSheet;
        } catch (e) {
            return null;
        }
    }

    isFactBaseEnabled(): boolean {
        return this.isEnabled;
    }


}