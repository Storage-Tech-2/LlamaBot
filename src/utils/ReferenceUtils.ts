// export function getAllPostReferencesInText(text: string): string[] {
//     const postReferenceRegex = /\b([A-Za-z]+[0-9]{3})\b/g;
//     return Array.from(text.matchAll(postReferenceRegex)).map(match => match[1]);
// }

import { Snowflake } from "discord.js";
import { recordsToRawTextNoHeaders, stripHyperlinkNames, SubmissionRecords } from "./MarkdownUtils.js";
import { GuildHolder } from "../GuildHolder.js";
import { Author, AuthorType } from "../submissions/Author.js";
import { ArchiveIndex, DictionaryEntryStatus } from "../archive/DictionaryManager.js";
import { getAuthorsString, reclassifyAuthors } from "./Util.js";

// Convenience patterns for dynamic reference extraction
export const PostCodePattern = /\b([A-Za-z]+[0-9]{3})\b/g;
export const DiscordForumLinkPattern = /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)(?:\/(\d+))?/g
export const UserMentionPattern = /<@!?(\d+)>/g;
export const ChannelMentionPattern = /<#(\d+)>/g;

export type AhoNodeOutput = {
    term: string;
};

type AhoNode<T extends AhoNodeOutput> = {
    children: Map<string, number>;
    fail: number;
    outputs: T[];
};

export type DictionaryMatch<T extends AhoNodeOutput> = {
    output: T;
    start: number;
    end: number;
};

export type DictionaryIndex<T extends AhoNodeOutput> = {
    nodes: AhoNode<T>[];
};

export type DictionaryIndexEntry = {
    term: string;
    id: Snowflake;
    url: string;
    status: DictionaryEntryStatus;
}

export type DictionaryTermIndex = {
    aho: DictionaryIndex<DictionaryIndexEntry>;
};

export enum ReferenceType {
    DISCORD_LINK = "discordLink",
    DICTIONARY_TERM = "dictionaryTerm",
    ARCHIVED_POST = "archivedPost",
    USER_MENTION = "userMention",
    CHANNEL_MENTION = "channelMention",
}

export type ReferenceBase = {
    type: ReferenceType,
    matches: string[]
}

export type DiscordLinkReference = ReferenceBase & {
    type: ReferenceType.DISCORD_LINK,
    url: string,
    server: Snowflake,
    serverName?: string,
    serverJoinURL?: string,
    channel: Snowflake,
    message?: Snowflake,
}

export type DictionaryTermReference = ReferenceBase & {
    type: ReferenceType.DICTIONARY_TERM,
    term: string,
    id: Snowflake,
    url: string,
}

export type ArchivedPostReference = ReferenceBase & {
    type: ReferenceType.ARCHIVED_POST,
    id: Snowflake,
    code: string,
    url: string,
}

export type UserMentionReference = ReferenceBase & {
    type: ReferenceType.USER_MENTION,
    user: Author,
}

export type ChannelMentionReference = ReferenceBase & {
    type: ReferenceType.CHANNEL_MENTION,
    channelID: Snowflake,
    channelName?: string,
    channelURL?: string,
}

export type Reference = DiscordLinkReference | DictionaryTermReference | ArchivedPostReference | UserMentionReference | ChannelMentionReference;

type ReferenceWithIndex = {
    start: number,
    end: number,
    ref: Reference
}

function createNode<T extends AhoNodeOutput>(): AhoNode<T> {
    return {
        children: new Map(),
        fail: 0,
        outputs: [],
    };
}

/**
 * Build an Aho–Corasick index for a list of dictionary terms.
 */
export function buildDictionaryIndex<T extends AhoNodeOutput>(terms: Map<string, T[]>): DictionaryIndex<T> {
    const nodes: AhoNode<T>[] = [createNode()];

    terms.forEach((value, term) => {
        if (!term) return;
        const normalized = term.toLowerCase();
        let current = 0;
        for (const ch of normalized) {
            if (!nodes[current].children.has(ch)) {
                nodes[current].children.set(ch, nodes.length);
                nodes.push(createNode());
            }
            current = nodes[current].children.get(ch)!;
        }
        nodes[current].outputs.push(...value);
    });

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

    return { nodes };
}

/**
 * Find all dictionary term matches in the given text using a prebuilt index.
 */
export function findDictionaryMatches<T extends AhoNodeOutput>(text: string, index: DictionaryIndex<T>): DictionaryMatch<T>[] {
    const normalizedText = text.toLowerCase();
    const matches: DictionaryMatch<T>[] = [];
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

        for (const output of index.nodes[state].outputs) {
            const start = i - output.term.length + 1;
            const end = i + 1;
            if (start < 0) continue;

            if (!shouldIncludeMatch(text, output.term, start, end)) {
                continue;
            }

            matches.push({
                output,
                start,
                end,
            });
        }
    }

    return matches;
}

function shouldIncludeMatch(text: string, term: string, start: number, end: number): boolean {
   

    const isTermAllCaps = term.toUpperCase() === term;
    const matchedText = text.slice(start, end);

    if (isTermAllCaps && matchedText !== term) { // case-sensitive match required
        return false;
    }


    const before = start > 0 ? text[start - 1] : undefined;
    const after = end < text.length ? text[end] : undefined;

    // check if term starts with leading number
    if (/^[0-9]/.test(term)) {

        // prev char must not be a number or decimal point
        if (before && (/[0-9.]/.test(before))) {
            return false;
        }
    }

    // check if term ends with trailing number
    if (/[0-9]$/.test(term)) {
        // next char must not be a number
        if (after && /[0-9]/.test(after)) {
            return false;
        }
    }
    
   
    const isWordChar = (ch: string | undefined): boolean => {
        return ch !== undefined && /[A-Za-z]/.test(ch);
    }

    let startSatisfied = isWordChar(before) === false;
    let endingSatisfied = isWordChar(after) === false;

    if (startSatisfied && endingSatisfied) {
        return true;
    }

     const hasNoNumbers = !/[0-9]/.test(term);

    if (hasNoNumbers && startSatisfied && !endingSatisfied) { // just some words
        // check if next character is possessive
        const getSliceAtEnd = (len: number): string => {
            return text.slice(end, Math.min(end + len, text.length));
        }
        const getCharAt = (pos: number): string | undefined => {
            pos += end;
            return pos < text.length ? text[pos] : undefined;
        }

        if (getCharAt(0) === "s" && !isWordChar(getCharAt(1))) {
            endingSatisfied = true;
        } else if (getSliceAtEnd(2) === "ed" && !isWordChar(getCharAt(2))) {
            endingSatisfied = true;
        } else if (getSliceAtEnd(3) === "ing" && !isWordChar(getCharAt(3))) {
            endingSatisfied = true;
        }

        if (endingSatisfied) {
            return true;
        }
    }

    return false;
}

export type RegexMatch = {
    pattern: string;
    match: string;
    start: number;
    end: number;
    groups: (string | undefined)[];
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
            const matched = match[0];
            const start = match.index;
            results.push({
                pattern: regex.source,
                match: matched,
                start,
                end: start + matched.length,
                groups: match.slice(1),
            });
            if (match[0].length === 0) {
                regex.lastIndex++;
            }
        }
    }
}

/**
 * Tag references in arbitrary text.
 */
export function tagReferencesInText(text: string, dictionaryIndex?: DictionaryTermIndex, archiveIndex?: ArchiveIndex): Reference[] {
    const references: ReferenceWithIndex[] = [];

    const discordMatches = findRegexMatches(text, [DiscordForumLinkPattern]);
    for (const match of discordMatches) {
        const [server, channel, message] = match.groups;
        if (!server || !channel) {
            continue;
        }

        references.push({
            start: match.start,
            end: match.end,
            ref: {
                type: ReferenceType.DISCORD_LINK,
                url: match.match,
                server: server as Snowflake,
                channel: channel as Snowflake,
                message: message as Snowflake | undefined,
                matches: [match.match],
            }
        });
    }

    const userMentionMatches = findRegexMatches(text, [UserMentionPattern]);
    for (const match of userMentionMatches) {
        const [userID] = match.groups;
        if (!userID) {
            continue;
        }

        references.push({
            start: match.start,
            end: match.end,
            ref: {
                type: ReferenceType.USER_MENTION,
                user: {
                    type: AuthorType.DiscordExternal,
                    id: userID as Snowflake
                },
                matches: [match.match],
            }
        });
    }

    const channelMentionMatches = findRegexMatches(text, [ChannelMentionPattern]);
    for (const match of channelMentionMatches) {
        const [channelID] = match.groups;
        if (!channelID) {
            continue;
        }

        references.push({
            start: match.start,
            end: match.end,
            ref: {
                type: ReferenceType.CHANNEL_MENTION,
                channelID: channelID as Snowflake,
                matches: [match.match],
            }
        });
    }

    if (dictionaryIndex) {
        const dictMatches = findDictionaryMatches(text, dictionaryIndex.aho);
        for (const match of dictMatches) {
            const matchedText = text.slice(match.start, match.end);
            if (match.output.status !== DictionaryEntryStatus.APPROVED) {
                continue;
            }
            references.push({
                start: match.start,
                end: match.end,
                ref: {
                    type: ReferenceType.DICTIONARY_TERM,
                    term: match.output.term,
                    id: match.output.id,
                    url: match.output.url,
                    matches: [matchedText],
                }
            });
        }
    }


    if (archiveIndex) {
        const postMatches = findRegexMatches(text, [PostCodePattern]);
        for (const match of postMatches) {
            const code = match.match.toUpperCase();
            const id = archiveIndex.codeToID.get(code);
            if (!id) {
                continue;
            }

            const url = archiveIndex.idToURL.get(id);
            if (!url) {
                continue;
            }

            references.push({
                start: match.start,
                end: match.end,
                ref: {
                    type: ReferenceType.ARCHIVED_POST,
                    id,
                    code,
                    url,
                    matches: [match.match]
                }
            });
        }
    }

    // Prefer larger spans when references overlap
    const byLengthDesc = [...references].sort((a, b) => {
        const lenA = a.end - a.start;
        const lenB = b.end - b.start;
        if (lenA !== lenB) return lenB - lenA;
        return a.start - b.start;
    });

    const deduped: ReferenceWithIndex[] = [];
    const overlaps = (a: { start: number, end: number }, b: { start: number, end: number }) =>
        a.start < b.end && a.end > b.start;

    for (const ref of byLengthDesc) {
        if (deduped.some(existing => overlaps(ref, existing))) {
            continue;
        }
        deduped.push(ref);
    }

    deduped.sort((a, b) => a.start - b.start || a.end - b.end);
    return deduped.map(o => o.ref);
}

export function deduplicateReferences(references: Reference[]): Reference[] {
    const newList: Reference[] = [];
    references.forEach((ref) => {
        const identical = newList.find((o) => {
            return referenceKey(o) === referenceKey(ref);
        });
        if (identical) {
            ref.matches.forEach((match) => {
                if (!identical.matches.includes(match)) {
                    identical.matches.push(match);
                }
            })
        } else {
            newList.push(ref);
        }
    })
    return newList;
}

export async function tagReferences(string: string, prevReferences: Reference[], guildHolder: GuildHolder, selfID: Snowflake, skipTerms: boolean = false) {
    if (!string) {
        return [];
    }

    const dictionaryManager = guildHolder.getDictionaryManager();
    const dictionaryIndex = skipTerms ? undefined : await dictionaryManager.getDictionaryTermIndex();

    const archiveIndex = await dictionaryManager.getArchiveIndex();
    const discords = await guildHolder.getDiscordServersDictionary().getCachedServersWithFallback();
    const currentServerID = guildHolder.getGuild().id;

    const revisionText = stripHyperlinkNames(string);
    const references = tagReferencesInText(revisionText, dictionaryIndex, archiveIndex);

    const newReferences: Reference[] = references.map((ref) => {
        if (ref.type !== ReferenceType.DISCORD_LINK) {
            return ref;
        }

        const match = prevReferences.find((a) => {
            if (a.type !== ReferenceType.ARCHIVED_POST) {
                return false;
            }
            return a.matches.includes(ref.matches[0]);
        })

        if (match && match.type === ReferenceType.ARCHIVED_POST) {
            const id = match.id;

            const url = archiveIndex.idToURL.get(id);
            if (!url) {
                return ref;
            }

            const newRef: ArchivedPostReference = {
                type: ReferenceType.ARCHIVED_POST,
                id: id,
                code: match.code,
                url: url,
                matches: ref.matches
            };
            return newRef;
        }

        if (ref.server === currentServerID) {
            const code = archiveIndex.threadToCode.get(ref.channel);
            if (!code) {
                return ref;
            }
            const id = archiveIndex.codeToID.get(code);
            if (!id) {
                return ref;
            }
            const url = archiveIndex.idToURL.get(id);
            if (!url) {
                return ref;
            }

            const newRef: ArchivedPostReference = {
                type: ReferenceType.ARCHIVED_POST,
                id,
                code,
                url,
                matches: ref.matches
            };
            return newRef;
        }

        const discordInfo = discords.find(d => d.id === ref.server);
        if (discordInfo) {
            ref.serverName = discordInfo.name;
            ref.serverJoinURL = discordInfo.joinURL;
        }

        return ref;
    }).filter((r) => {
        if (r.type === ReferenceType.DICTIONARY_TERM || r.type === ReferenceType.ARCHIVED_POST) {
            if (r.id === selfID) {
                return false;
            }
        }
        return true;
    })

    const deduped = deduplicateReferences(newReferences);

    await Promise.all(deduped.map(async (ref) => {
        if (ref.type === ReferenceType.USER_MENTION) {
            ref.user = (await reclassifyAuthors(guildHolder, [ref.user]))[0];
        } else if (ref.type === ReferenceType.CHANNEL_MENTION) {
            const channel = await guildHolder.getGuild().channels.fetch(ref.channelID).catch(() => null);
            if (channel) {
                ref.channelName = channel.name;
                ref.channelURL = channel.url;
            }
        }
    }));

    return deduped;
}


export async function tagReferencesInSubmissionRecords(records: SubmissionRecords, prevReferences: Reference[], guildHolder: GuildHolder, selfID: Snowflake) {
    const rawText = recordsToRawTextNoHeaders(records).trim();
    if (!rawText) {
        return [];
    }
    return tagReferences(rawText, prevReferences, guildHolder, selfID);
}

export async function tagReferencesInAcknowledgements(authors: Author[], prevReferences: Reference[], guildHolder: GuildHolder, selfID: Snowflake) {
    const rawText = authors.filter(a => a.reason?.trim()).map(a => a.reason).join('\n').trim();
    if (!rawText) {
        return [];
    }
    return tagReferences(rawText, prevReferences, guildHolder, selfID, true);
}

export function findMatchesWithinText(text: string, references: Reference[]): {
    reference: Reference;
    start: number;
    end: number;
}[] {
    const matches: {
        reference: Reference;
        start: number;
        end: number;
    }[] = [];

    for (const ref of references) {
        for (const matchText of ref.matches) {
            let startIndex = 0;
            while (startIndex < text.length) {
                const index = text.indexOf(matchText, startIndex);
                if (index === -1) break;
                matches.push({
                    reference: ref,
                    start: index,
                    end: index + matchText.length,
                });
                startIndex = index + matchText.length;
            }
        }
    }

    return matches;
}


export type ServerLinksMap = Map<Snowflake, { id: Snowflake, name: string, joinURL: string }>;

export function transformOutputWithReferences(
    text: string,
    references: Reference[],
    isDiscord: boolean = false,
    excludedIDs: Set<Snowflake> = new Set(),
    serverLinks: ServerLinksMap = new Map()
): {
    result: string,
    excludedIDs: Set<Snowflake>,
    serverLinks: ServerLinksMap
} {
    const matches = findMatchesWithinText(text, references);
    if (matches.length === 0) {
        return {
            result: text,
            excludedIDs,
            serverLinks
        }
    }

    const filteredMatches = matches.filter(({ start, end }) => {
        return shouldIncludeMatch(text, text.slice(start, end), start, end);
    });

    filteredMatches.sort((a, b) => a.start - b.start);

    // remove overlapping matches, prefer earlier matches
    const dedupedMatches: typeof matches = [];
    let lastEnd = -1;
    for (const match of filteredMatches) {
        if (match.start >= lastEnd) {
            dedupedMatches.push(match);
            lastEnd = match.end;
        }
    }

    // detect markdown hyperlinks
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const hyperlinks = findRegexMatches(text, [regex]);

    const resultParts: string[] = [];
    let currentIndex = 0;

    // if a match is within a hyperlink, do custom processing
    for (const match of dedupedMatches) {
        // check if excluded
        if (match.reference.type === ReferenceType.DICTIONARY_TERM && excludedIDs.has(match.reference.id)) {
            continue;
        }

        // check if in header (#'s in front)
        let inHeader = false;
        const lastNewline = text.lastIndexOf('\n', match.start);
        if (lastNewline !== -1) {
            const lineStart = lastNewline + 1;
            let i = lineStart;
            while (i < match.start && text[i] === ' ') {
                i++;
            }
            let hashCount = 0;
            while (i < match.start && text[i] === '#') {
                hashCount++;
                i++;
            }
            if (hashCount > 0) {
                inHeader = true;
            }
        }
        if (inHeader) { // skip
            continue;
        }

        // check if match is within a hyperlink
        const hyperlink = hyperlinks.find(h => match.start >= h.start && match.end <= h.end);

        if (hyperlink) {
            // add text before hyperlink
            if (currentIndex < hyperlink.start) {
                resultParts.push(text.slice(currentIndex, hyperlink.start));
            }
        } else {
            // add text before match
            if (currentIndex < match.start) {
                resultParts.push(text.slice(currentIndex, match.start));
            }
        }

        const ref = match.reference;


        if (ref.type === ReferenceType.DICTIONARY_TERM) {
            if (hyperlink) { // skip
                resultParts.push(text.slice(hyperlink.start, hyperlink.end));
                currentIndex = hyperlink.end;
            } else {
                // create markdown link
                const linkedText = `[${text.slice(match.start, match.end)}](${ref.url})`;
                resultParts.push(linkedText);
                currentIndex = match.end;

                excludedIDs.add(ref.id);
            }
        } else if (ref.type === ReferenceType.ARCHIVED_POST) {
            if (hyperlink) { // dont skip, replace
                // get hyperlink text
                const linkText = hyperlink.groups[0] || "";
                if (linkText.toUpperCase() === ref.code) {
                    // same as code, just replace URL
                    const linkedText = `[${linkText}](${ref.url})`;
                    resultParts.push(linkedText);
                } else {
                    // different, keep text but add suffix
                    const linkedText = `[${linkText} (${ref.code})](${ref.url})`;
                    resultParts.push(linkedText);
                }
                currentIndex = hyperlink.end;
            } else {
                // check if match is discord url
                const isDiscordLink = DiscordForumLinkPattern.test(text.slice(match.start, match.end));
                if (isDiscordLink && isDiscord) {
                    // keep as is, just replace URL
                    resultParts.push(ref.url);
                    currentIndex = match.end;
                } else {
                    // create markdown link with code as text
                    const linkedText = `[${ref.code}](${ref.url})`;
                    resultParts.push(linkedText);
                    currentIndex = match.end;
                }
            }
        } else if (ref.type === ReferenceType.DISCORD_LINK) {
            if (ref.server && ref.serverJoinURL && !serverLinks.has(ref.server)) {
                serverLinks.set(ref.server, {
                    id: ref.server,
                    name: ref.serverName || "Unknown",
                    joinURL: ref.serverJoinURL
                });
            }

            if (hyperlink) {
                if (isDiscord && ref.serverName) {
                    // add server name suffix
                    const linkText = hyperlink.groups[0] || "";
                    const linkedText = `[${linkText} (in ${ref.serverName})](${ref.url})`;
                    resultParts.push(linkedText);
                    currentIndex = hyperlink.end;
                } else {
                    resultParts.push(text.slice(hyperlink.start, hyperlink.end));
                    currentIndex = hyperlink.end;
                }
            } else {
                resultParts.push(text.slice(match.start, match.end));
                currentIndex = match.end;

                if (isDiscord && ref.serverName) {
                    // add server name suffix
                    resultParts.push(` (in ${ref.serverName})`);
                }
            }

            if (!isDiscord && ref.serverName && ref.serverJoinURL) {
                // add server
                resultParts.push(` ([Join ${ref.serverName}](${ref.serverJoinURL}))`);
            }
        } else if (ref.type === ReferenceType.USER_MENTION) {
            if (hyperlink) { // skip
                resultParts.push(text.slice(hyperlink.start, hyperlink.end));
                currentIndex = hyperlink.end;
            } else if (isDiscord) {
                const text = getAuthorsString([ref.user]);
                resultParts.push(text);
                currentIndex = match.end;
            } else {
                const text = ref.user.displayName || ref.user.username || "Unknown User";
                resultParts.push(`[@${text}](# "ID: ${ref.user.id}")`);
                currentIndex = match.end;
            }
        } else if (ref.type === ReferenceType.CHANNEL_MENTION) {
            if (hyperlink) { // skip
                resultParts.push(text.slice(hyperlink.start, hyperlink.end));
                currentIndex = hyperlink.end;
            } else if (isDiscord && ref.channelName) {
                const linkedText = `<#${ref.channelID}>`;
                resultParts.push(linkedText);
                currentIndex = match.end;
            } else if (ref.channelName && ref.channelURL) {
                const linkedText = `[#${ref.channelName}](${ref.channelURL})`;
                resultParts.push(linkedText);
                currentIndex = match.end;
            } else {
                const linkedText = `[Unknown Channel](# "ID: ${ref.channelID}")`;
                resultParts.push(linkedText);
                currentIndex = match.end;
            }
        }
    }

    // add remaining text
    if (currentIndex < text.length) {
        resultParts.push(text.slice(currentIndex));
    }

    return {
        result: resultParts.join(''),
        excludedIDs,
        serverLinks
    }
}


export function areReferencesIdentical(a: Reference, b: Reference): boolean {
    if (a.type === ReferenceType.ARCHIVED_POST && b.type === ReferenceType.ARCHIVED_POST) {
        return a.code === b.code && a.id === b.id && a.url === b.url;
    } else if (a.type === ReferenceType.DISCORD_LINK && b.type === ReferenceType.DISCORD_LINK) {
        return a.server === b.server && a.channel === b.channel && a.message === b.message && a.url === b.url && a.serverName === b.serverName && a.serverJoinURL === b.serverJoinURL;
    } else if (a.type === ReferenceType.DICTIONARY_TERM && b.type === ReferenceType.DICTIONARY_TERM) {
        return a.id === b.id && a.term === b.term && a.url === b.url;
    } else if (a.type === ReferenceType.USER_MENTION && b.type === ReferenceType.USER_MENTION) {
        return a.user.id === b.user.id && a.user.type === b.user.type && a.user.username === b.user.username && a.user.displayName === b.user.displayName;
    } else if (a.type === ReferenceType.CHANNEL_MENTION && b.type === ReferenceType.CHANNEL_MENTION) {
        return a.channelID === b.channelID && a.channelName === b.channelName && a.channelURL === b.channelURL;
    }
    return false;
}


export function referenceKey(ref: Reference): string {
    if (ref.type === ReferenceType.ARCHIVED_POST) {
        return `archivedPost:${ref.code}`;
    } else if (ref.type === ReferenceType.DISCORD_LINK) {
        return `discordLink:${ref.server}:${ref.channel}:${ref.message || ''}`;
    } else if (ref.type === ReferenceType.DICTIONARY_TERM) {
        return `dictionaryTerm:${ref.id}`;
    } else if (ref.type === ReferenceType.USER_MENTION) {
        return `userMention:${ref.user.id}`;
    } else if (ref.type === ReferenceType.CHANNEL_MENTION) {
        return `channelMention:${ref.channelID}`;
    } else {
        return 'unknown';
    }
}

export function hasReferencesChanged(oldRefs: Reference[], newRefs: Reference[]): {
    added: Reference[];
    removed: Reference[];
    updated: Reference[];
    result: Reference[];
    changed: boolean;
} {
    const mapOld = new Map<string, Reference>();
    oldRefs.forEach(ref => {
        const key = referenceKey(ref);
        mapOld.set(key, ref);
    });

    const mapNew = new Map<string, Reference>();
    newRefs.forEach(ref => {
        const key = referenceKey(ref);
        mapNew.set(key, ref);
    });

    const oldKeys = new Set(mapOld.keys());
    const newKeys = new Set(mapNew.keys());

    const added = newKeys.difference(oldKeys);
    const removed = oldKeys.difference(newKeys);
    const same = oldKeys.intersection(newKeys);
    const updated: Reference[] = [];
    const result: Reference[] = [];

    same.forEach(key => {
        const oldRef = mapOld.get(key)!;
        const newRef = mapNew.get(key)!;
        if (!areReferencesIdentical(oldRef, newRef)) {
            updated.push(newRef);
        }
        result.push(newRef);
    });

    added.forEach(key => {
        const newRef = mapNew.get(key)!;
        result.push(newRef);
    });

    return {
        added: Array.from(added).map(key => mapNew.get(key)!),
        removed: Array.from(removed).map(key => mapOld.get(key)!),
        updated,
        result,
        changed: added.size > 0 || removed.size > 0 || updated.length > 0
    };
}
