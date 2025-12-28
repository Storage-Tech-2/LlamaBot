import { Author } from "../submissions/Author.js";
import { ArchiveEntry } from "./ArchiveEntry.js";
import { areAuthorsSame, reclassifyAuthors } from "../utils/Util.js";
import { GuildHolder } from "../GuildHolder.js";
import { ArchiveChannelReference } from "./RepositoryConfigs.js";
import { ChannelType, ChatInputCommandInteraction, ForumChannel } from "discord.js";
import { ArchiveChannel } from "./ArchiveChannel.js";
import { SubmissionConfigs } from "../submissions/SubmissionConfigs.js";
import Path from "path";
import { hasReferencesChanged, ReferenceType, tagReferences, tagReferencesInAcknowledgements, tagReferencesInSubmissionRecords } from "../utils/ReferenceUtils.js";

export async function updateEntryAuthorsTask(guildHolder: GuildHolder): Promise<number> {
    const repositoryManager = guildHolder.getRepositoryManager();
    if (!repositoryManager.isReady()) {
        return 0;
    }

    await repositoryManager.getLock().acquire();

    // First, collect authors
    const authors: Author[] = [];

    await repositoryManager.iterateAllEntries(async (entry: ArchiveEntry) => {
        const entryData = entry.getData();
        for (const author of entryData.authors) {
            if (!authors.some(a => areAuthorsSame(a, author))) {
                authors.push(author);
            }
        }
        for (const endorser of entryData.endorsers) {
            if (!authors.some(a => areAuthorsSame(a, endorser))) {
                authors.push(endorser);
            }
        }
    });


    const reclassified: Author[] = [];
    const chunkSize = 10;
    for (let i = 0; i < authors.length; i += chunkSize) {
        const chunk = authors.slice(i, i + chunkSize);
        const reclassifiedChunk = await reclassifyAuthors(guildHolder, chunk);
        reclassified.push(...reclassifiedChunk);
    }

    let modifiedCount = 0;
    await repositoryManager.iterateAllEntries(async (entry: ArchiveEntry, channelRef: ArchiveChannelReference) => {
        try {
            if (await repositoryManager.updateEntryAuthors(entry, reclassified)) {
                modifiedCount++;
            }
        } catch (e: any) {
            console.error(`Error updating authors for entry ${entry.getData().name} in channel ${channelRef.name}:`, e.message);
        }
    });

    if (modifiedCount > 0) {
        try {
            await repositoryManager.commit(`Updated authors for ${modifiedCount} entries`);
            try {
                await repositoryManager.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }
        }
        catch (e: any) {
            console.error("Error committing updated authors:", e.message);
        }
    }
    repositoryManager.getLock().release();
    return modifiedCount;
}

export async function republishAllEntries(
    guildHolder: GuildHolder,
    doChannel: ForumChannel | null,
    replace: boolean, silent: boolean,
    interaction: ChatInputCommandInteraction
): Promise<void> {
    const repositoryManager = guildHolder.getRepositoryManager();

    if (!repositoryManager.isReady()) {
        throw new Error("Git not initialized");
    }

    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error("Interaction channel is not a text channel");
    }

    await repositoryManager.getLock().acquire();
    try {
        const channelRefs = repositoryManager.getChannelReferences();
        for (const channelRef of channelRefs) {
            const channelPath = Path.join(repositoryManager.folderPath, channelRef.path);
            const archiveChannel = await ArchiveChannel.fromFolder(channelPath);
            if (doChannel && archiveChannel.getData().id !== doChannel.id) {
                continue;
            }
            for (const entryRef of archiveChannel.getData().entries) {
                const entryPath = Path.join(channelPath, entryRef.path);
                const entry = await ArchiveEntry.fromFolder(entryPath);

                if (!entry) {
                    await channel.send({ content: `Entry ${entryRef.name} (${entryRef.code}) could not be loaded, skipping.` });
                    continue; // Skip if entry cannot be loaded
                }
                const entryData = entry.getData();

                const submission = await guildHolder.getSubmissionsManager().getSubmission(entryData.id);
                // Get channel
                const submissionChannel = submission ? await submission.getSubmissionChannel(true) : null;
                const wasArchived = submissionChannel && submissionChannel.archived;
                if (wasArchived) {
                    await submissionChannel.setArchived(false);
                }


                let result;
                if (!entryData.post) {
                    await channel.send({ content: `Entry ${entryData.code} does not have a post, skipping.` });
                } else {
                    try {
                        result = await repositoryManager.addOrUpdateEntryFromData(entryData, entryData.post.forumId, replace, true, async () => { });
                        await channel.send({ content: `Entry ${entryData.code} republished: ${result.newEntryData.post?.threadURL}` });
                    } catch (e: any) {
                        console.error(e);
                        await channel.send({ content: `Error republishing entry ${entryData.code}: ${e.message}` });
                    }
                }

                // Get submission
                if (!submission || !submissionChannel) {
                    await channel.send({ content: `Submission for entry ${entryData.code} not found, skipping.` });
                    continue;
                }

                submission.getConfigManager().setConfig(SubmissionConfigs.POST, result?.newEntryData.post || null);

                try {
                    await submission.statusUpdated();
                    if (!silent) {
                        await submissionChannel.send(`Republished by bulk republish command, the post is now at ${result?.newEntryData?.post?.threadURL}`);
                    }
                } catch (e: any) {
                    await channel.send({ content: `Error updating submission ${entryData.code} status: ${e.message}` });
                }

                if (wasArchived) {
                    await submissionChannel.setArchived(true);
                }
            }
        }

        // Commit changes
        await repositoryManager.commit(`Republished all entries${doChannel ? ` in channel ${doChannel.name}` : ''}`);

        try {
            await repositoryManager.push();
        } catch (e: any) {
            console.error("Error pushing to remote:", e.message);
        }

        repositoryManager.getLock().release();
    } catch (e) {
        repositoryManager.getLock().release();
        throw e;
    }

}

export async function updateAuthorAndChannelTagsTask(guildHolder: GuildHolder): Promise<void> {
    const repositoryManager = guildHolder.getRepositoryManager();
    if (!repositoryManager.isReady()) {
        return;
    }
    await repositoryManager.getLock().acquire();

    let modifiedCount = 0;


    // First, collect authors
    const authors: Author[] = [];
    const channels: {
        id: string;
        name?: string;
        url?: string
    }[] = [];

    await repositoryManager.iterateAllEntries(async (entry: ArchiveEntry) => {
        const entryData = entry.getData();
        entryData.references.forEach(ref => {
            if (ref.type === ReferenceType.USER_MENTION) {
                if (!authors.some(a => a.id === ref.user.id)) {
                    authors.push(ref.user);
                }
            } else if (ref.type === ReferenceType.CHANNEL_MENTION) {
                if (!channels.some(c => c.id === ref.channelID)) {
                    channels.push({
                        id: ref.channelID,
                        name: ref.channelName,
                        url: ref.channelURL
                    });
                }
            }
        });
        entryData.author_references.forEach(ref => {
            if (ref.type === ReferenceType.USER_MENTION) {
                if (!authors.some(a => a.id === ref.user.id)) {
                    authors.push(ref.user);
                }
            } else if (ref.type === ReferenceType.CHANNEL_MENTION) {
                if (!channels.some(c => c.id === ref.channelID)) {
                    channels.push({
                        id: ref.channelID,
                        name: ref.channelName,
                        url: ref.channelURL
                    });
                }
            }
        });
    });

    const dictionaryManager = guildHolder.getDictionaryManager();

    await dictionaryManager.iterateEntries(async (definition) => {
        definition.references.forEach(ref => {
            if (ref.type === ReferenceType.USER_MENTION) {
                if (!authors.some(a => a.id === ref.user.id)) {
                    authors.push(ref.user);
                }
            } else if (ref.type === ReferenceType.CHANNEL_MENTION) {
                if (!channels.some(c => c.id === ref.channelID)) {
                    channels.push({
                        id: ref.channelID,
                        name: ref.channelName,
                        url: ref.channelURL
                    });
                }
            }
        });
    });

    const chunkSize = 10;
    const reclassified: Author[] = [];
    for (let i = 0; i < authors.length; i += chunkSize) {
        const chunk = authors.slice(i, i + chunkSize);
        const reclassifiedChunk = await reclassifyAuthors(guildHolder, chunk);
        reclassified.push(...reclassifiedChunk);
    }

    await repositoryManager.iterateAllEntries(async (entry: ArchiveEntry, channelRef: ArchiveChannelReference) => {
        const data = entry.getData();
        const newReferences = data.references.map(ref => {
            if (ref.type === ReferenceType.USER_MENTION) {
                const updatedAuthor = reclassified.find(a => a.id === ref.user.id);
                if (updatedAuthor) {
                    ref.user = updatedAuthor;
                }
            } else if (ref.type === ReferenceType.CHANNEL_MENTION) {
                const updatedChannel = channels.find(c => c.id === ref.channelID);
                if (updatedChannel) {
                    ref.channelName = updatedChannel.name;
                    ref.channelURL = updatedChannel.url;
                }
            }
            return ref;
        });

        const newAuthorReferences = data.author_references.map(ref => {
            if (ref.type === ReferenceType.USER_MENTION) {
                const updatedAuthor = reclassified.find(a => a.id === ref.user.id);
                if (updatedAuthor) {
                    ref.user = updatedAuthor;
                }
            } else if (ref.type === ReferenceType.CHANNEL_MENTION) {
                const updatedChannel = channels.find(c => c.id === ref.channelID);
                if (updatedChannel) {
                    ref.channelName = updatedChannel.name;
                    ref.channelURL = updatedChannel.url;
                }
            }
            return ref;
        });

        const changed = hasReferencesChanged(data.references, newReferences).changed ||
            hasReferencesChanged(data.author_references, newAuthorReferences).changed;
        if (!changed) {
            return;
        }

        data.references = newReferences;
        data.author_references = newAuthorReferences;

        await repositoryManager.addOrUpdateEntryFromData(data, channelRef.id, false, false, async () => { }).catch((e) => {
            console.error(`Error updating references for entry ${data.name} in channel ${channelRef.name}:`, e.message);
        });
        modifiedCount++;
    });

    await dictionaryManager.iterateEntries(async (definition) => {
        const newReferences = definition.references.map(ref => {
            if (ref.type === ReferenceType.USER_MENTION) {
                const updatedAuthor = reclassified.find(a => a.id === ref.user.id);
                if (updatedAuthor) {
                    ref.user = updatedAuthor;
                }
            } else if (ref.type === ReferenceType.CHANNEL_MENTION) {
                const updatedChannel = channels.find(c => c.id === ref.channelID);
                if (updatedChannel) {
                    ref.channelName = updatedChannel.name;
                    ref.channelURL = updatedChannel.url;
                }
            }
            return ref;
        });

        const changed = hasReferencesChanged(definition.references, newReferences).changed;
        if (!changed) {
            return;
        }
        definition.references = newReferences;
        await dictionaryManager.saveEntry(definition).catch((e) => {
            console.error(`Error updating references for definition ${definition.terms[0]}:`, e.message);
        });
        await dictionaryManager.updateStatusMessage(definition).catch((e) => {
            console.error(`Error updating status message for definition ${definition.terms[0]}:`, e.message);
        });
        modifiedCount++;
    });

    if (modifiedCount > 0) {
        try {
            await repositoryManager.commit(`Updated author and channel tags for ${modifiedCount} items`);
            try {
                await repositoryManager.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }
        }
        catch (e: any) {
            console.error("Error committing updated author and channel tags:", e.message);
        }
    }
    repositoryManager.getLock().release();
}

export async function retagEverythingTask(guildHolder: GuildHolder): Promise<void> {
    const repositoryManager = guildHolder.getRepositoryManager();
    if (!repositoryManager.isReady()) {
        return;
    }

    guildHolder.requestRetagging(false);

    await repositoryManager.getLock().acquire();

    const definitionToEntryCodes: Map<string, Set<string>> = new Map();

    let modifiedCount = 0;
    await repositoryManager.iterateAllEntries(async (entry: ArchiveEntry, channelRef: ArchiveChannelReference) => {
        const data = entry.getData();
        const newReferences = await tagReferencesInSubmissionRecords(data.records, data.references, guildHolder, data.id);
        const newAuthorReferences = await tagReferencesInAcknowledgements(data.authors, data.author_references, guildHolder, data.id);

        const changed = hasReferencesChanged(data.references, newReferences).changed ||
            hasReferencesChanged(data.author_references, newAuthorReferences).changed;
        if (!changed) {
            return;
        }

        data.references = newReferences;

        newReferences.forEach((ref) => {
            if (ref.type !== ReferenceType.DICTIONARY_TERM) return;
            const defID = ref.id;
            if (!definitionToEntryCodes.has(defID)) {
                definitionToEntryCodes.set(defID, new Set());
            }
            definitionToEntryCodes.get(defID)!.add(data.code);
        });

        data.author_references = newAuthorReferences;

        await repositoryManager.addOrUpdateEntryFromData(data, channelRef.id, false, false, async () => { }).catch((e) => {
            console.error(`Error updating references for entry ${data.name} in channel ${channelRef.name}:`, e.message);
        });
        modifiedCount++;
    }).catch((e) => {
        console.error("Error during retagging:", e);
    });

    // update definitions
    const dictionaryManager = guildHolder.getDictionaryManager();
    await dictionaryManager.iterateEntries(async (definition) => {
        const newReferences = await tagReferences(definition.definition, definition.references, guildHolder, definition.id);
        let changed = hasReferencesChanged(definition.references, newReferences).changed;
        const entryCodes = definitionToEntryCodes.get(definition.id);
        if (entryCodes && entryCodes.intersection(new Set(definition.referencedBy)).size !== entryCodes.size) {
            changed = true;
            definition.referencedBy = Array.from(entryCodes);
        }

        if (!changed) {
            return;
        }
        definition.references = newReferences;
        await dictionaryManager.saveEntry(definition).catch((e) => {
            console.error(`Error updating references for definition ${definition.terms[0]}:`, e.message);
        });
        await dictionaryManager.updateStatusMessage(definition).catch((e) => {
            console.error(`Error updating status message for definition ${definition.terms[0]}:`, e.message);
        });
        modifiedCount++;
    }).catch((e) => {
        console.error("Error during retagging definitions:", e);
    });

    if (modifiedCount > 0) {
        try {
            await repositoryManager.commit(`Retagged references for ${modifiedCount} items`);
            try {
                await repositoryManager.push();
            } catch (e: any) {
                console.error("Error pushing to remote:", e.message);
            }
        }
        catch (e: any) {
            console.error("Error committing retagged references:", e.message);
        }
    }
    repositoryManager.getLock().release();
}