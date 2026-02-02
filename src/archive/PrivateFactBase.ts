import Path from "path";
import fs from "fs/promises";
import { EmbeddingsEntry, base64ToInt8Array, makeHNSWIndex, EmbeddingsSearchResult, loadHNSWIndex, generateDocumentEmbeddings } from "../llm/EmbeddingUtils.js";
import { TemporaryCache } from "./TemporaryCache.js";
import { HierarchicalNSW } from "hnswlib-node";
import { Snowflake } from "discord.js";

export type QAFactSheet = {
    identifier: string;
    question: string;
    answer: string;
    category: string;
    cited: Array<Snowflake>;
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

    private async getJSONFileList(): Promise<string[]> {
        try {
            const files = await fs.readdir(this.folderPath);
            return files.filter(file => file.endsWith('.json'));
        } catch (e) {
            return [];
        }
    }

    private async getFactsCategories(): Promise<string[]> {
        const jsonFiles = await this.getJSONFileList();
        // every file except embeddings.json and embeddings_lookup.json is a fact category
        const categories = jsonFiles.filter(file => file !== 'embeddings.json' && file !== 'embeddings_lookup.json')
            .map(file => file.replace('.json', ''));
        return categories;
    }

    private async init() {

        // first, check if JSON files exist in the folder
        const factCategories = await this.getFactsCategories();
        if (factCategories.length === 0) {
            this.isEnabled = false;
            return;
        }

        console.log(`[PrivateFactBase] Found ${factCategories.length} fact categories.`);

        // check if embeddings file exists
        const embeddings = await this.getEmbeddings();
        if (!embeddings) {
            // make embeddings for all facts
            await this.buildEmbeddingsIndex();
            this.isEnabled = true;
            return;
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
        const factCategories = await this.getFactsCategories();
        const factsForEmbedding: Array<{ identifier: string; text: string; }> = [];

        for (const category of factCategories) {
            const categoryPath = Path.join(this.folderPath, `${category}.json`);
            const fileContents = await fs.readFile(categoryPath, 'utf-8').catch(() => null);
            if (!fileContents) {
                continue;
            }

            let facts: QAFactSheet[] = [];
            try {
                facts = JSON.parse(fileContents) as QAFactSheet[];
            } catch (e) {
                continue;
            }

            for (const fact of facts) {
                const identifier = `${category}::${fact.identifier}`;
                const text = `Q: ${fact.question}\nA: ${fact.answer}`;
                factsForEmbedding.push({ identifier, text });
            }
        }

        if (factsForEmbedding.length === 0) {
            await fs.writeFile(this.getEmbeddingsPath(), JSON.stringify([], null, 2), 'utf-8').catch(() => null);
            await fs.writeFile(Path.join(this.folderPath, 'embeddings_lookup.json'), JSON.stringify([], null, 2), 'utf-8').catch(() => null);
            await fs.unlink(this.getEmbeddingsIndexPath()).catch(() => null);
            this.hnswIndexCache.clear();
            return;
        }

        const existingEmbeddings = await this.getEmbeddings();
        const embeddingsMap = new Map<string, EmbeddingsEntry>(existingEmbeddings.map(entry => [entry.identifier, entry]));
        const validIdentifiers = new Set(factsForEmbedding.map(fact => fact.identifier));

        for (const identifier of Array.from(embeddingsMap.keys())) {
            if (!validIdentifiers.has(identifier)) {
                embeddingsMap.delete(identifier);
            }
        }

        const missingFacts = factsForEmbedding.filter(fact => !embeddingsMap.has(fact.identifier));
        const chunkSize = 100;
        for (let i = 0; i < missingFacts.length; i += chunkSize) {
            const chunk = missingFacts.slice(i, i + chunkSize);
            const embeddingResult = await generateDocumentEmbeddings(chunk.map(item => item.text)).catch(() => null);
            if (!embeddingResult || embeddingResult.embeddings.length === 0) {
                continue;
            }

            for (let j = 0; j < chunk.length && j < embeddingResult.embeddings.length; j++) {
                const chunkItem = chunk[j];
                embeddingsMap.set(chunkItem.identifier, {
                    identifier: chunkItem.identifier,
                    embedding: embeddingResult.embeddings[j],
                    updated_at: Date.now(),
                });
            }
        }

        const orderedEmbeddings: EmbeddingsEntry[] = [];
        for (const fact of factsForEmbedding) {
            const entry = embeddingsMap.get(fact.identifier);
            if (entry) {
                orderedEmbeddings.push(entry);
            }
        }

        await fs.writeFile(this.getEmbeddingsPath(), JSON.stringify(orderedEmbeddings, null, 2), 'utf-8');

        if (orderedEmbeddings.length === 0) {
            await fs.writeFile(Path.join(this.folderPath, 'embeddings_lookup.json'), JSON.stringify([], null, 2), 'utf-8');
            await fs.unlink(this.getEmbeddingsIndexPath()).catch(() => null);
            this.hnswIndexCache.clear();
            return;
        }

        const embeddingVectors: Int8Array[] = orderedEmbeddings.map(entry => base64ToInt8Array(entry.embedding));
        const lookupFile = orderedEmbeddings.map(entry => entry.identifier);
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

    async getFact(identifier: string): Promise<QAFactSheet | null> {
        if (!this.isEnabled) {
            return null;
        }
        const [category, factId] = identifier.split('::');
        if (!category || !factId) {
            return null;
        }

        const path = Path.join(this.folderPath, `${category}.json`);
        
        const data = await fs.readFile(path, 'utf-8').then(content => JSON.parse(content) as QAFactSheet[]).catch(() => null);
        if (!data) {
            return null;
        }

        const fact = data.find(f => f.identifier === factId);
        return fact || null;
    }


    async updateFact(identifier: string, entry: QAFactSheet): Promise<void> {
        if (!this.isEnabled) {
            return;
        }
        const [category, factId] = identifier.split('::');
        if (!category || !factId) {
            return;
        }

        const path = Path.join(this.folderPath, `${category}.json`);
        
        // read existing file
        const data = await fs.readFile(path, 'utf-8').then(content => JSON.parse(content) as QAFactSheet[]).catch(() => null);
        if (!data) {
            return;
        }

        // find and update entry
        const index = data.findIndex(f => f.identifier === factId);
        if (index === -1) {
            return;
        }
        data[index] = entry;

        // write updated entry
        await fs.writeFile(path, JSON.stringify(entry, null, 2), 'utf-8');

        // update embeddings
        const embeddings = await this.getEmbeddings();
        const embeddingEntry = embeddings.find(e => e.identifier === identifier);
        if (!embeddingEntry) {
            return;
        }

        // re-embed text
        const text = `Q: ${entry.question}\nA: ${entry.answer}`;
        const newEmbedding = await generateDocumentEmbeddings([text]).catch(() => null);
        if (!newEmbedding || newEmbedding.embeddings.length === 0) {
            return;
        }
        embeddingEntry.embedding = newEmbedding.embeddings[0];

        // save embeddings
        const embeddingsPath = this.getEmbeddingsPath();
        await fs.writeFile(embeddingsPath, JSON.stringify(embeddings, null, 2), 'utf-8');
        
        // rebuild index
        await this.buildEmbeddingsIndex();
    }

    isFactBaseEnabled(): boolean {
        return this.isEnabled;
    }


}