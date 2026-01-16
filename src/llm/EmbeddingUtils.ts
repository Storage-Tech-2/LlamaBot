import got from "got";
import HNSW from "hnswlib-node";

const URL = 'http://localhost:8000/embed'
const NUM_DIMENSIONS = 256;

export type EmbeddingsEntry = {
    identifier: string;
    updated_at: number;
    embedding: string; // base64 encoded string
}

export type EmbeddingsSearchResult = {
    identifier: string;
    distance: number;
}

export function generateDocumentEmbeddings(texts: string[]): Promise<{ embeddings: string[] }> {
    return got.post(URL, {
        json: {
            texts: texts,
            model_type: 'document'
        },
        timeout: {
            request: 120000 // 120 seconds
        }
    }).json() as Promise<{ embeddings: string[] }>;
}


export async function getClosestWithIndex(index: HNSW.HierarchicalNSW, embeddings: EmbeddingsEntry[], embedding: Int8Array, numNeighbors: number): Promise<EmbeddingsSearchResult[]> {
    const result = index.searchKnn(Array.from(embedding), numNeighbors);
    const results: { identifier: string; distance: number }[] = [];
    for (let i = 0; i < result.neighbors.length; i++) {
        const neighborIdx = result.neighbors[i];
        const distance = result.distances[i];
        if (neighborIdx < 0 || neighborIdx >= embeddings.length) {
            continue;
        }
        results.push({
            identifier: embeddings[neighborIdx].identifier,
            distance: distance
        });
    }

    // sort in ascending order of distance
    results.sort((a, b) => a.distance - b.distance);
    return results;
}


export function generateQueryEmbeddings(texts: string[]): Promise<{ embeddings: string[] }> {
    return got.post(URL, {
        json: {
            texts: texts,
            model_type: 'query'
        },
        timeout: {
            request: 60000 // 60 seconds
        }
    }).json() as Promise<{ embeddings: string[] }>;
}

export function base64ToInt8Array(base64: string): Int8Array {
    const binaryString = Buffer.from(base64, 'base64');
    return new Int8Array(binaryString);
}

export async function makeHNSWIndex(embeddings: Int8Array[], savePath: string): Promise<HNSW.HierarchicalNSW> {
    const index = new HNSW.HierarchicalNSW('cosine', NUM_DIMENSIONS);
    index.initIndex(embeddings.length);
    embeddings.forEach((embedding, idx) => {
        index.addPoint(Array.from(embedding), idx);
    });

    await index.writeIndex(savePath);
    return index;
}

export async function loadHNSWIndex(loadPath: string): Promise<HNSW.HierarchicalNSW> {
    const index = new HNSW.HierarchicalNSW('cosine', NUM_DIMENSIONS);
    await index.readIndex(loadPath);
    return index;
}

export function cosineSimilarity(vecA: Int8Array, vecB: Int8Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function computeSimilarities(queryEmbedding: Int8Array, documentEmbeddings: Int8Array[]): number[] {
    return documentEmbeddings.map(docEmb => cosineSimilarity(queryEmbedding, docEmb));
}