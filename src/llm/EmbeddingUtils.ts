import got from "got";

const URL = 'http://localhost:8000/embed'

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

