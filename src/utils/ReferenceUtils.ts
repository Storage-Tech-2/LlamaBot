// export function getAllPostReferencesInText(text: string): string[] {
//     const postReferenceRegex = /\b([A-Za-z]+[0-9]{3})\b/g;
//     return Array.from(text.matchAll(postReferenceRegex)).map(match => match[1]);
// }

// Example post references
// "ABC123", "DEF456", "GHI789"

// Example discord forum links
// To the forum thread:
// https://discord.com/channels/1375556143186837695/1388316667855241277
// To a message in the forum thread:
// https://discord.com/channels/1375556143186837695/1388316667855241277/1388316670208249948

type AhoNode = {
    children: Map<string, number>;
    fail: number;
    outputs: string[];
};

export type DictionaryMatch = {
    term: string;
    start: number;
    end: number;
};

export type DictionaryIndex = {
    nodes: AhoNode[];
    caseInsensitive: boolean;
};

export type DictionaryTermIndex = {
    map: Map<string, Set<string>>;
    aho: DictionaryIndex;
};

const DICTIONARY_INDEX_MAGIC = Buffer.from('DCTIDX1');

function createNode(): AhoNode {
    return {
        children: new Map(),
        fail: 0,
        outputs: [],
    };
}

/**
 * Build an Aho–Corasick index for a list of dictionary terms.
 */
export function buildDictionaryIndex(terms: string[], caseInsensitive: boolean = true): DictionaryIndex {
    const nodes: AhoNode[] = [createNode()];
    const normalize = (s: string) => (caseInsensitive ? s.toLowerCase() : s);

    for (const term of terms) {
        if (!term) continue;
        const normalized = normalize(term);
        let current = 0;
        for (const ch of normalized) {
            if (!nodes[current].children.has(ch)) {
                nodes[current].children.set(ch, nodes.length);
                nodes.push(createNode());
            }
            current = nodes[current].children.get(ch)!;
        }
        nodes[current].outputs.push(term);
    }

    // Build failure links with BFS
    const queue: number[] = [];
    for (const [_, childIndex] of nodes[0].children) {
        nodes[childIndex].fail = 0;
        queue.push(childIndex);
    }

    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const [ch, childIndex] of nodes[current].children) {
            let fail = nodes[current].fail;
            while (fail !== 0 && !nodes[fail].children.has(ch)) {
                fail = nodes[fail].fail;
            }
            const fallback = nodes[fail].children.get(ch);
            nodes[childIndex].fail = fallback !== undefined ? fallback : 0;
            nodes[childIndex].outputs.push(...nodes[nodes[childIndex].fail].outputs);
            queue.push(childIndex);
        }
    }

    return { nodes, caseInsensitive };
}

/**
 * Find all dictionary term matches in the given text using a prebuilt index.
 */
export function findDictionaryMatches(text: string, index: DictionaryIndex, opts?: { wholeWords?: boolean }): DictionaryMatch[] {
    const wholeWords = opts?.wholeWords ?? false;
    const normalize = (s: string) => (index.caseInsensitive ? s.toLowerCase() : s);
    const normalizedText = normalize(text);
    const matches: DictionaryMatch[] = [];
    let state = 0;

    for (let i = 0; i < normalizedText.length; i++) {
        const ch = normalizedText[i];
        while (state !== 0 && !index.nodes[state].children.has(ch)) {
            state = index.nodes[state].fail;
        }
        const next = index.nodes[state].children.get(ch);
        if (next !== undefined) {
            state = next;
        }

        if (index.nodes[state].outputs.length === 0) {
            continue;
        }

        for (const term of index.nodes[state].outputs) {
            const start = i - term.length + 1;
            const end = i + 1;
            if (start < 0) continue;
            if (wholeWords && !isWholeWord(normalizedText, start, end)) {
                continue;
            }
            matches.push({
                term,
                start,
                end,
            });
        }
    }

    return matches;
}

function isWordChar(ch: string | undefined): boolean {
    if (!ch) return false;
    return /[A-Za-z0-9_]/.test(ch);
}

function isWholeWord(text: string, start: number, end: number): boolean {
    const before = start > 0 ? text[start - 1] : undefined;
    const after = end < text.length ? text[end] : undefined;
    return !isWordChar(before) && !isWordChar(after);
}

export function encodeDictionaryTermIndex(index: DictionaryTermIndex): Buffer {
    const terms = Array.from(index.map.keys());
    const termToIndex = new Map<string, number>(terms.map((t, i) => [t, i]));
    const chunks: number[] = [];

    const writeUint8 = (v: number) => { chunks.push(v & 0xFF); };
    const writeUint16 = (v: number) => {
        chunks.push(v & 0xFF, (v >> 8) & 0xFF);
    };
    const writeUint32 = (v: number) => {
        chunks.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF);
    };
    const writeString = (v: string, lengthWriter: (len: number) => void) => {
        const buf = Buffer.from(v, 'utf8');
        lengthWriter(buf.length);
        chunks.push(...buf);
    };

    chunks.push(...DICTIONARY_INDEX_MAGIC);
    writeUint8(index.aho.caseInsensitive ? 1 : 0);

    writeUint32(terms.length);
    for (const term of terms) {
        writeString(term, writeUint16);
        const ids = Array.from(index.map.get(term) || []);
        writeUint32(ids.length);
        for (const id of ids) {
            writeString(id, writeUint8);
        }
    }

    writeUint32(index.aho.nodes.length);
    for (const node of index.aho.nodes) {
        writeUint16(node.children.size);
        for (const [ch, childIndex] of node.children) {
            const code = ch.codePointAt(0) || 0;
            writeUint16(code);
            writeUint32(childIndex);
        }
        writeUint32(node.fail);
        writeUint16(node.outputs.length);
        for (const term of node.outputs) {
            const idx = termToIndex.get(term);
            writeUint32(idx === undefined ? 0xFFFFFFFF : idx);
        }
    }

    return Buffer.from(chunks);
}

export function decodeDictionaryTermIndex(data: Buffer): DictionaryTermIndex {
    let offset = 0;
    const readUint8 = () => data.readUInt8(offset++);
    const readUint16 = () => {
        const v = data.readUInt16LE(offset);
        offset += 2;
        return v;
    };
    const readUint32 = () => {
        const v = data.readUInt32LE(offset);
        offset += 4;
        return v;
    };
    const readString = (lengthReader: () => number) => {
        const len = lengthReader();
        const str = data.slice(offset, offset + len).toString('utf8');
        offset += len;
        return str;
    };

    const magic = data.slice(0, DICTIONARY_INDEX_MAGIC.length);
    if (!magic.equals(DICTIONARY_INDEX_MAGIC)) {
        throw new Error('Invalid dictionary index format');
    }
    offset = DICTIONARY_INDEX_MAGIC.length;

    const caseInsensitive = readUint8() === 1;

    const termCount = readUint32();
    const terms: string[] = [];
    const map: Map<string, Set<string>> = new Map();
    for (let i = 0; i < termCount; i++) {
        const term = readString(readUint16);
        terms.push(term);
        const idCount = readUint32();
        const ids: string[] = [];
        for (let j = 0; j < idCount; j++) {
            ids.push(readString(readUint8));
        }
        map.set(term, new Set(ids));
    }

    const nodeCount = readUint32();
    const nodes: DictionaryIndex['nodes'] = [];
    for (let i = 0; i < nodeCount; i++) {
        const childCount = readUint16();
        const children = new Map<string, number>();
        for (let c = 0; c < childCount; c++) {
            const code = readUint16();
            const childIndex = readUint32();
            children.set(String.fromCodePoint(code), childIndex);
        }
        const fail = readUint32();
        const outputsCount = readUint16();
        const outputs: string[] = [];
        for (let o = 0; o < outputsCount; o++) {
            const termIdx = readUint32();
            if (termIdx !== 0xFFFFFFFF && termIdx < terms.length) {
                outputs.push(terms[termIdx]);
            }
        }
        nodes.push({ children, fail, outputs });
    }

    return {
        map,
        aho: {
            caseInsensitive,
            nodes,
        },
    };
}

export type RegexMatch = {
    pattern: string;
    match: string;
    start: number;
    end: number;
};

/**
 * Find matches for arbitrary regex patterns (must be global) in the provided text.
 * This can be used to dynamically include patterns like post codes or Discord forum links.
 */
export function findRegexMatches(text: string, patterns: RegExp[]): RegexMatch[] {
    const results: RegexMatch[] = [];
    for (const pattern of patterns) {
        if (!pattern.global) {
            // ensure global flag for iterative matching
            const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
            const globalPattern = new RegExp(pattern.source, flags);
            collectMatches(globalPattern);
        } else {
            collectMatches(pattern);
        }
    }
    return results;

    function collectMatches(regex: RegExp) {
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            const matched = match[1] ?? match[0];
            const start = match.index + (match[0].indexOf(matched));
            results.push({
                pattern: regex.source,
                match: matched,
                start,
                end: start + matched.length,
            });
            if (match[0].length === 0) {
                regex.lastIndex++;
            }
        }
    }
}

// Convenience patterns for dynamic reference extraction
export const PostCodePattern = /\b([A-Za-z]+[0-9]{3})\b/g;
export const DiscordForumLinkPattern = /https?:\/\/(?:canary\.|ptb\.)?discord\.com\/channels\/\d+\/\d+(?:\/\d+)?/g;
