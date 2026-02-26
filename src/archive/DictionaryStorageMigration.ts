import fs from "fs/promises";
import Path from "path";
import type { Snowflake } from "discord.js";
import { safeJoinPath } from "../utils/SafePath.js";

type DictionaryEntryStatusValue = "PENDING" | "APPROVED" | "REJECTED";

type DictionaryEntryForMigration = {
    id: Snowflake;
    terms: string[];
    definition: string;
    threadURL: string;
    statusURL: string;
    status: DictionaryEntryStatusValue;
    statusMessageID?: Snowflake;
    updatedAt: number;
    references: unknown[];
    referencedBy: string[];
};

type RepositoryStaging = {
    add(paths: string | string[]): Promise<void>;
    rm(paths: string | string[]): Promise<void>;
};

export type DictionaryStorageMigrationResult = {
    movedToSubmissions: number;
    movedToRepository: number;
    duplicatesResolved: number;
    repositoryChanged: boolean;
};

const APPROVED_STATUS: DictionaryEntryStatusValue = "APPROVED";

function normalizeStatus(status: unknown): DictionaryEntryStatusValue {
    if (status === "PENDING" || status === "REJECTED" || status === "APPROVED") {
        return status;
    }
    // Legacy entries may predate explicit status support. Keep them public by default.
    return APPROVED_STATUS;
}

function normalizeEntry(raw: unknown, fallbackId: Snowflake): DictionaryEntryForMigration | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const rawRecord = raw as Record<string, unknown>;
    const id = (typeof rawRecord.id === "string" ? rawRecord.id : fallbackId) as Snowflake;
    if (!id) {
        return null;
    }

    const terms = Array.isArray(rawRecord.terms)
        ? rawRecord.terms.map(term => String(term).trim()).filter(term => term.length > 0)
        : [];

    const referencedBy = Array.isArray(rawRecord.referencedBy)
        ? rawRecord.referencedBy.map(code => String(code).trim()).filter(code => code.length > 0)
        : [];

    const references = Array.isArray(rawRecord.references) ? rawRecord.references : [];

    const updatedAtRaw = rawRecord.updatedAt;
    const updatedAt = typeof updatedAtRaw === "number" && Number.isFinite(updatedAtRaw) && updatedAtRaw > 0
        ? updatedAtRaw
        : Date.now();

    return {
        id,
        terms,
        definition: typeof rawRecord.definition === "string" ? rawRecord.definition : "",
        threadURL: typeof rawRecord.threadURL === "string" ? rawRecord.threadURL : "",
        statusURL: typeof rawRecord.statusURL === "string" ? rawRecord.statusURL : "",
        status: normalizeStatus(rawRecord.status),
        statusMessageID: typeof rawRecord.statusMessageID === "string" ? rawRecord.statusMessageID as Snowflake : undefined,
        updatedAt,
        references,
        referencedBy,
    };
}

async function fileExists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true).catch(() => false);
}

async function listEntryIds(entriesPath: string): Promise<Set<Snowflake>> {
    await fs.mkdir(entriesPath, { recursive: true });
    const files = await fs.readdir(entriesPath).catch(() => []);
    const ids = new Set<Snowflake>();
    for (const file of files) {
        if (!file.endsWith(".json")) {
            continue;
        }
        ids.add(file.slice(0, -5) as Snowflake);
    }
    return ids;
}

async function readEntry(filePath: string, fallbackId: Snowflake): Promise<DictionaryEntryForMigration | null> {
    const raw = await fs.readFile(filePath, "utf-8").catch(() => null);
    if (raw === null) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as unknown;
        return normalizeEntry(parsed, fallbackId);
    } catch {
        return null;
    }
}

function pickPreferredEntry(
    repositoryEntry: DictionaryEntryForMigration | null,
    submissionEntry: DictionaryEntryForMigration | null
): DictionaryEntryForMigration | null {
    if (!repositoryEntry) {
        return submissionEntry;
    }
    if (!submissionEntry) {
        return repositoryEntry;
    }

    if (repositoryEntry.updatedAt !== submissionEntry.updatedAt) {
        return repositoryEntry.updatedAt > submissionEntry.updatedAt ? repositoryEntry : submissionEntry;
    }

    if (repositoryEntry.status !== submissionEntry.status) {
        if (repositoryEntry.status === APPROVED_STATUS) {
            return repositoryEntry;
        }
        if (submissionEntry.status === APPROVED_STATUS) {
            return submissionEntry;
        }
    }

    if (repositoryEntry.terms.length !== submissionEntry.terms.length) {
        return repositoryEntry.terms.length > submissionEntry.terms.length ? repositoryEntry : submissionEntry;
    }

    return repositoryEntry;
}

async function writeEntryIfChanged(filePath: string, entry: DictionaryEntryForMigration): Promise<boolean> {
    await fs.mkdir(Path.dirname(filePath), { recursive: true });
    const next = JSON.stringify(entry, null, 2);
    const current = await fs.readFile(filePath, "utf-8").catch(() => null);
    if (current === next) {
        return false;
    }
    await fs.writeFile(filePath, next, "utf-8");
    return true;
}

export async function runDictionaryStorageMigration(
    repositoryEntriesPath: string,
    submissionsEntriesPath: string,
    repositoryStaging: RepositoryStaging
): Promise<DictionaryStorageMigrationResult> {
    await Promise.all([
        fs.mkdir(repositoryEntriesPath, { recursive: true }),
        fs.mkdir(submissionsEntriesPath, { recursive: true }),
    ]);

    const [repositoryIds, submissionIds] = await Promise.all([
        listEntryIds(repositoryEntriesPath),
        listEntryIds(submissionsEntriesPath),
    ]);

    const allIds = new Set<Snowflake>([
        ...Array.from(repositoryIds.values()),
        ...Array.from(submissionIds.values()),
    ]);

    const result: DictionaryStorageMigrationResult = {
        movedToSubmissions: 0,
        movedToRepository: 0,
        duplicatesResolved: 0,
        repositoryChanged: false,
    };

    for (const id of allIds) {
        const repositoryPath = safeJoinPath(repositoryEntriesPath, `${id}.json`);
        const submissionPath = safeJoinPath(submissionsEntriesPath, `${id}.json`);

        const [repositoryEntry, submissionEntry] = await Promise.all([
            readEntry(repositoryPath, id),
            readEntry(submissionPath, id),
        ]);

        const chosen = pickPreferredEntry(repositoryEntry, submissionEntry);
        if (!chosen) {
            continue;
        }

        const repositoryExists = await fileExists(repositoryPath);
        const submissionExists = await fileExists(submissionPath);
        const targetInRepository = chosen.status === APPROVED_STATUS;

        if (targetInRepository) {
            const wroteRepository = await writeEntryIfChanged(repositoryPath, chosen);
            if (wroteRepository) {
                await repositoryStaging.add(repositoryPath).catch(() => { });
                result.repositoryChanged = true;
            }

            if (submissionExists) {
                await fs.unlink(submissionPath).catch(() => { });
            }

            if (!repositoryExists && submissionExists) {
                result.movedToRepository++;
            } else if (repositoryExists && submissionExists) {
                result.duplicatesResolved++;
            }
            continue;
        }

        await writeEntryIfChanged(submissionPath, chosen);

        if (repositoryExists) {
            await repositoryStaging.rm(repositoryPath).catch(() => { });
            await fs.unlink(repositoryPath).catch(() => { });
            result.repositoryChanged = true;
        }

        if (repositoryExists && !submissionExists) {
            result.movedToSubmissions++;
        } else if (repositoryExists && submissionExists) {
            result.duplicatesResolved++;
        }
    }

    return result;
}
