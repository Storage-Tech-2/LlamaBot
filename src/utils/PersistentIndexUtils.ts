import { StyleInfo } from "./MarkdownUtils.js";

export type PersistentIndex = {
    updated_at: number;
    all_tags: string[];
    all_authors: string[];
    all_categories: string[];
    schemaStyles: Record<string, StyleInfo>;
    channels: PersistentIndexChannel[]
}

export type PersistentIndexChannel = {
    code: string;
    name: string;
    description: string;
    category: number;
    tags: number[];
    path: string;
    entries: PersistentIndexEntry[];
}

export type PersistentIndexEntry = {
    codes: string[]
    name: string;
    authors: number[];
    tags: number[];
    updated_at: number;
    archived_at: number;
    path: string;
    main_image_path: string | null;
}

export function serializePersistentIndex(index: PersistentIndex): ArrayBuffer {
    let bufferParts = [];

    const textEncoder = new TextEncoder();

    // first part: version and updated_at
    const header = new ArrayBuffer(10);
    const headerView = new DataView(header);
    headerView.setUint16(0, 1); // version
    headerView.setBigUint64(2, BigInt(index.updated_at));
    bufferParts.push(header);

    // second part: all_tags
    const allTagsCount = new Uint16Array([index.all_tags.length]);
    bufferParts.push(allTagsCount.buffer);
    for (const tag of index.all_tags) {
        const tagBytes = textEncoder.encode(tag);
        const tagLength = new Uint16Array([tagBytes.length]);
        bufferParts.push(tagLength.buffer);
        bufferParts.push(tagBytes.buffer);
    }

    // third part: all_authors
    const allAuthorsCount = new Uint16Array([index.all_authors.length]);
    bufferParts.push(allAuthorsCount.buffer);
    for (const author of index.all_authors) {
        const authorBytes = textEncoder.encode(author);
        const authorLength = new Uint16Array([authorBytes.length]);
        bufferParts.push(authorLength.buffer);
        bufferParts.push(authorBytes.buffer);
    }

    // fourth part: all_categories
    const allCategoriesCount = new Uint16Array([index.all_categories.length]);
    bufferParts.push(allCategoriesCount.buffer);
    for (const category of index.all_categories) {
        const categoryBytes = textEncoder.encode(category);
        const categoryLength = new Uint16Array([categoryBytes.length]);
        bufferParts.push(categoryLength.buffer);
        bufferParts.push(categoryBytes.buffer);
    }

    // Schema styles (just json)
    const schemaStylesJson = JSON.stringify(index.schemaStyles);
    const schemaStylesBytes = textEncoder.encode(schemaStylesJson);
    const schemaStylesLength = new Uint32Array([schemaStylesBytes.length]);
    bufferParts.push(schemaStylesLength.buffer);
    bufferParts.push(schemaStylesBytes.buffer);

    // Channels
    for (const channel of index.channels) {
        // Code
        const codeBytes = textEncoder.encode(channel.code);
        const codeLength = new Uint16Array([codeBytes.length]);
        bufferParts.push(codeLength.buffer);
        bufferParts.push(codeBytes.buffer);

        // Name
        const nameBytes = textEncoder.encode(channel.name);
        const nameLength = new Uint16Array([nameBytes.length]);
        bufferParts.push(nameLength.buffer);
        bufferParts.push(nameBytes.buffer);

        // Description
        const descBytes = textEncoder.encode(channel.description);
        const descLength = new Uint16Array([descBytes.length]);
        bufferParts.push(descLength.buffer);
        bufferParts.push(descBytes.buffer);

        // Category
        const categoryBuffer = new Uint16Array([channel.category]);
        bufferParts.push(categoryBuffer.buffer);

        // Tags
        const tagsArray = new Uint16Array(channel.tags.length);
        channel.tags.forEach((tagIndex, i) => {
            tagsArray[i] = tagIndex;
        });
        const tagsLength = new Uint16Array([channel.tags.length]);
        bufferParts.push(tagsLength.buffer);
        bufferParts.push(tagsArray.buffer);

        // Path
        const pathBytes = textEncoder.encode(channel.path);
        const pathLength = new Uint16Array([pathBytes.length]);
        bufferParts.push(pathLength.buffer);
        bufferParts.push(pathBytes.buffer);

        // Entries
        const entriesCount = new Uint32Array([channel.entries.length]);
        bufferParts.push(entriesCount.buffer);
        for (const entry of channel.entries) {
            // Codes
            const entryCodeBytes = textEncoder.encode(entry.codes.join(','));
            const entryCodeLength = new Uint16Array([entryCodeBytes.length]);
            bufferParts.push(entryCodeLength.buffer);
            bufferParts.push(entryCodeBytes.buffer);

            // Name
            const entryNameBytes = textEncoder.encode(entry.name);
            const entryNameLength = new Uint16Array([entryNameBytes.length]);
            bufferParts.push(entryNameLength.buffer);
            bufferParts.push(entryNameBytes.buffer);

            // Authors
            const authorsArray = new Uint16Array(entry.authors.length);
            entry.authors.forEach((authorIndex, i) => {
                authorsArray[i] = authorIndex;
            });
            const authorsLength = new Uint16Array([entry.authors.length]);
            bufferParts.push(authorsLength.buffer);
            bufferParts.push(authorsArray.buffer);

            // Tags
            const entryTagsArray = new Uint16Array(entry.tags.length);
            entry.tags.forEach((tagIndex, i) => {
                entryTagsArray[i] = tagIndex;
            });
            const entryTagsLength = new Uint16Array([entry.tags.length]);
            bufferParts.push(entryTagsLength.buffer);
            bufferParts.push(entryTagsArray.buffer);

            // updated_at
            const updatedAtBuffer = new ArrayBuffer(8);
            const updatedAtView = new DataView(updatedAtBuffer);
            updatedAtView.setBigUint64(0, BigInt(entry.updated_at));
            bufferParts.push(updatedAtBuffer);

            // archived_at
            const archivedAtBuffer = new ArrayBuffer(8);
            const archivedAtView = new DataView(archivedAtBuffer);
            archivedAtView.setBigUint64(0, BigInt(entry.archived_at));
            bufferParts.push(archivedAtBuffer);

            // Path
            const entryPathBytes = textEncoder.encode(entry.path);
            const entryPathLength = new Uint16Array([entryPathBytes.length]);
            bufferParts.push(entryPathLength.buffer);
            bufferParts.push(entryPathBytes.buffer);

            // Main image path
            if (entry.main_image_path) {
                const mainImagePathBytes = textEncoder.encode(entry.main_image_path);
                const mainImagePathLength = new Uint16Array([mainImagePathBytes.length]);
                bufferParts.push(mainImagePathLength.buffer);
                bufferParts.push(mainImagePathBytes.buffer);
            } else {
                const mainImagePathLength = new Uint16Array([0]);
                bufferParts.push(mainImagePathLength.buffer);
            }
        }
    }

    // Combine all parts into a single ArrayBuffer
    const totalLength = bufferParts.reduce((sum, part) => sum + part.byteLength, 0);
    const combinedBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of bufferParts) {
        combinedBuffer.set(new Uint8Array(part), offset);
        offset += part.byteLength;
    }

    return combinedBuffer.buffer;
}

export function deserializePersistentIndex(buffer: ArrayBuffer): PersistentIndex {
    const textDecoder = new TextDecoder();
    const dataView = new DataView(buffer);
    let offset = 0;

    // Read version and updated_at
    const version = dataView.getUint16(offset);
    if (version !== 1) {
        throw new Error(`Unsupported persistent index version: ${version}`);
    }
    offset += 2;
    const updated_at = Number(dataView.getBigUint64(offset));
    offset += 8;

    // Read all_tags
    const allTagsCount = dataView.getUint16(offset);
    offset += 2;
    const all_tags = [];
    for (let i = 0; i < allTagsCount; i++) {
        const tagLength = dataView.getUint16(offset);
        offset += 2;
        const tagBytes = new Uint8Array(buffer, offset, tagLength);
        const tag = textDecoder.decode(tagBytes);
        all_tags.push(tag);
        offset += tagLength;
    }

    // Read all_authors
    const allAuthorsCount = dataView.getUint16(offset);
    offset += 2;
    const all_authors = [];
    for (let i = 0; i < allAuthorsCount; i++) {
        const authorLength = dataView.getUint16(offset);
        offset += 2;
        const authorBytes = new Uint8Array(buffer, offset, authorLength);
        const author = textDecoder.decode(authorBytes);
        all_authors.push(author);
        offset += authorLength;
    }

    // Read all_categories
    const allCategoriesCount = dataView.getUint16(offset);
    offset += 2;
    const all_categories = [];
    for (let i = 0; i < allCategoriesCount; i++) {
        const categoryLength = dataView.getUint16(offset);
        offset += 2;
        const categoryBytes = new Uint8Array(buffer, offset, categoryLength);
        const category = textDecoder.decode(categoryBytes);
        all_categories.push(category);
        offset += categoryLength;
    }

    // Read schemaStyles
    const schemaStylesLength = dataView.getUint32(offset);
    offset += 4;
    const schemaStylesBytes = new Uint8Array(buffer, offset, schemaStylesLength);
    const schemaStylesJson = textDecoder.decode(schemaStylesBytes);
    const schemaStyles: Record<string, StyleInfo> = JSON.parse(schemaStylesJson);
    offset += schemaStylesLength;

    // Read channels
    const channels = [];
    while (offset < buffer.byteLength) {
        // Code
        const codeLength = dataView.getUint16(offset);
        offset += 2;
        const codeBytes = new Uint8Array(buffer, offset, codeLength);
        const code = textDecoder.decode(codeBytes);
        offset += codeLength;

        // Name
        const nameLength = dataView.getUint16(offset);
        offset += 2;
        const nameBytes = new Uint8Array(buffer, offset, nameLength);
        const name = textDecoder.decode(nameBytes);
        offset += nameLength;

        // Description
        const descLength = dataView.getUint16(offset);
        offset += 2;
        const descBytes = new Uint8Array(buffer, offset, descLength);
        const description = textDecoder.decode(descBytes);
        offset += descLength;

        // Category
        const category = dataView.getUint16(offset);
        offset += 2;

        // Tags
        const tagsCount = dataView.getUint16(offset);
        offset += 2;
        const tags = [];
        for (let i = 0; i < tagsCount; i++) {
            const tagIndex = dataView.getUint16(offset);
            offset += 2;
            tags.push(tagIndex);
        }

        // Path
        const pathLength = dataView.getUint16(offset);
        offset += 2;
        const pathBytes = new Uint8Array(buffer, offset, pathLength);
        const path = textDecoder.decode(pathBytes);
        offset += pathLength;

        // Entries
        const entriesCount = dataView.getUint32(offset);
        offset += 4;
        const entries = [];
        for (let i = 0; i < entriesCount; i++) {
            // Code
            const entryCodeLength = dataView.getUint16(offset);
            offset += 2;
            const entryCodeBytes = new Uint8Array(buffer, offset, entryCodeLength);
            const entryCodes = textDecoder.decode(entryCodeBytes).split(',');
            offset += entryCodeLength;

            // Name
            const entryNameLength = dataView.getUint16(offset);
            offset += 2;
            const entryNameBytes = new Uint8Array(buffer, offset, entryNameLength);
            const entryName = textDecoder.decode(entryNameBytes);
            offset += entryNameLength;

            // Authors
            const authorsCount = dataView.getUint16(offset);
            offset += 2;
            const authors = [];
            for (let j = 0; j < authorsCount; j++) {
                const authorIndex = dataView.getUint16(offset);
                offset += 2;
                authors.push(authorIndex);
            }

            // Tags
            const entryTagsCount = dataView.getUint16(offset);
            offset += 2;
            const entryTags = [];
            for (let j = 0; j < entryTagsCount; j++) {
                const tagIndex = dataView.getUint16(offset);
                offset += 2;
                entryTags.push(tagIndex);
            }

            // updated_at
            const entryUpdatedAt = Number(dataView.getBigUint64(offset));
            offset += 8;

            // archived_at
            const entryArchivedAt = Number(dataView.getBigUint64(offset));
            offset += 8;

            // Path
            const entryPathLength = dataView.getUint16(offset);
            offset += 2;
            const entryPathBytes = new Uint8Array(buffer, offset, entryPathLength);
            const entryPath = textDecoder.decode(entryPathBytes);
            offset += entryPathLength;

            // Main image path
            const mainImagePathLength = dataView.getUint16(offset);
            offset += 2;
            let main_image_path: string | null = null;
            if (mainImagePathLength > 0) {
                const mainImagePathBytes = new Uint8Array(buffer, offset, mainImagePathLength);
                main_image_path = textDecoder.decode(mainImagePathBytes);
                offset += mainImagePathLength;
            }

            entries.push({
                codes: entryCodes,
                name: entryName,
                authors: authors,
                tags: entryTags,
                updated_at: entryUpdatedAt,
                archived_at: entryArchivedAt,
                path: entryPath,
                main_image_path: main_image_path
            });
        }

        channels.push({
            code: code,
            name: name,
            description: description,
            category: category,
            tags: tags,
            path: path,
            entries: entries
        });
    }

    return {
        updated_at,
        all_tags,
        all_authors,
        all_categories,
        schemaStyles,
        channels
    };
}