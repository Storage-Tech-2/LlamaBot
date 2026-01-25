import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import Path from 'path';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import yauzl from 'yauzl';
import nbt from 'prismarine-nbt';

const MAX_ENTRY_UNCOMPRESSED_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB per entry
const MAX_TOTAL_UNCOMPRESSED_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB overall
const MAX_ENTRIES = 20000;

const MC_SELECTOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_LEVEL_DAT_BYTES = 64 * 1024 * 1024; // 64 MB

const MC_SELECTOR_QUERY = 'InhabitedTime = 0 AND !(Palette intersects "observer,repeater,comparator,piston,sticky_piston,redstone_torch,redstone_wire,redstone_wall_torch,hopper,dispenser,dropper,crafter")';
const MC_SELECTOR_JAR = Path.join(process.cwd(), 'java', 'mcaselector-2.6.1.jar');

export type WorldMetadata = {
    path: string; // always relative to root zip; nested zips separated by '/'
    version?: string;
    levelName?: string;
    error?: string;
};

type ExtractionBudget = {
    remainingBytes: number;
    perEntryLimit: number;
};

type ZipSource = { zipPath?: string; buffer?: Buffer };

type ArchiveContext = {
    relPath: string;           // '' for root, 'foo.zip', 'foo.zip/bar.zip', etc.
    extractDir: string;        // directory containing extracted contents
    zipOutputPath?: string;    // where to write the zipped file for this archive inside its parent; undefined for root
};

/**
 * Optimize a WDL zip: extract (including nested zips), analyze worlds, run MCSelector on each world, and repackage.
 * Returns metadata for all worlds with paths relative to the input zip.
 */
export async function optimizeWorldDownloads(zipPath: string, tempDir: string, outputFile?: string): Promise<{ zipPath: string; worlds: WorldMetadata[] }> {
    const tempRoot = Path.resolve(tempDir);
    await fs.mkdir(tempRoot, { recursive: true });

    const sessionRoot = tempRoot;
    const rootExtractDir = Path.join(sessionRoot, 'root');
    await fs.mkdir(rootExtractDir, { recursive: true });

    const outputZipPath = outputFile ? Path.resolve(outputFile) : Path.join(
        tempRoot,
        `${Path.basename(zipPath, Path.extname(zipPath)) || 'world'}-optimized-${Date.now().toString(36)}.zip`
    );
    await fs.rm(outputZipPath, { force: true });
    await fs.mkdir(Path.dirname(outputZipPath), { recursive: true });

    await fs.access(MC_SELECTOR_JAR).catch(() => {
        throw new Error(`MCSelector jar not found at ${MC_SELECTOR_JAR}`);
    });

    const budget: ExtractionBudget = {
        remainingBytes: MAX_TOTAL_UNCOMPRESSED_BYTES,
        perEntryLimit: MAX_ENTRY_UNCOMPRESSED_BYTES
    };
    const contexts: ArchiveContext[] = [];
    let nestedCounter = 0;
    await extractArchiveRecursive({
        source: { zipPath: Path.resolve(zipPath) },
        relPath: '',
        extractDir: rootExtractDir,
        getNextExtractDir: (suffix: string) => Path.join(sessionRoot, `nested-${nestedCounter++}-${suffix}`),
        budget,
        contexts
    });

    const worlds = await analyzeExtractedWorlds(contexts);
    if (worlds.length === 0) {
        throw new Error('No Minecraft world folders (containing level.dat) found in the archive');
    }

    await optimizeWorlds(worlds, contexts);
    await repackageArchives(contexts, outputZipPath);

    return { zipPath: outputZipPath, worlds };
}

/**
 * Analyze a WDL zip (file path or buffer) without writing to disk. Returns metadata with paths relative to the zip root.
 */
export async function analyzeWorldDownloads(zipSource: string | Buffer, budget?: ExtractionBudget): Promise<WorldMetadata[]> {
    const sessionBudget: ExtractionBudget = budget ?? {
        remainingBytes: MAX_TOTAL_UNCOMPRESSED_BYTES,
        perEntryLimit: MAX_ENTRY_UNCOMPRESSED_BYTES
    };
    const source: ZipSource = typeof zipSource === 'string' ? { zipPath: Path.resolve(zipSource) } : { buffer: zipSource };
    return analyzeZipRecursive(source, '', sessionBudget);
}

// -------- Extraction --------

async function extractArchiveRecursive(params: {
    source: ZipSource;
    relPath: string;
    extractDir: string;
    getNextExtractDir: (suffix: string) => string;
    budget: ExtractionBudget;
    contexts: ArchiveContext[];
}): Promise<void> {
    const { source, relPath, extractDir, getNextExtractDir, budget, contexts } = params;
    contexts.push({ relPath, extractDir, zipOutputPath: relPath ? extractDir.replace(/\/$/, '') : undefined });

    await extractArchiveContents({
        source,
        relPath,
        extractDir,
        getNextExtractDir,
        budget,
        contexts
    });
}

async function extractArchiveContents(params: {
    source: ZipSource;
    relPath: string;
    extractDir: string;
    getNextExtractDir: (suffix: string) => string;
    budget: ExtractionBudget;
    contexts: ArchiveContext[];
}): Promise<void> {
    const { source, relPath, extractDir, getNextExtractDir, budget, contexts } = params;
    await fs.mkdir(extractDir, { recursive: true });

    const zipfile = await openZipSource(source);

    await new Promise<void>((resolve, reject) => {
        let finished = false;
        let entryCount = 0;
        const rootWithSep = extractDir.endsWith(Path.sep) ? extractDir : `${extractDir}${Path.sep}`;
        const takenPaths = new Map<string, 'file' | 'dir'>(); // avoid collisions


        const fail = (error: unknown) => {
            if (finished) return;
            finished = true;
            zipfile.close();
            reject(error instanceof Error ? error : new Error(String(error)));
        };

        const succeed = () => {
            if (finished) return;
            finished = true;
            zipfile.close();
            resolve();
        };

        const uniquePath = (desired: string, isDir: boolean): string => {
            let candidate = desired;
            let counter = 1;
            while (takenPaths.has(candidate)) {
                const dir = Path.dirname(desired);
                const base = Path.basename(desired);
                const ext = isDir ? '' : Path.extname(base);
                const name = isDir ? base : Path.basename(base, ext);
                candidate = Path.join(dir, `${name}__dup${counter}${ext}`);
                counter += 1;
            }
            return candidate;
        };

        const handleEntry = async (entry: yauzl.Entry) => {
            entryCount += 1;
            if (entryCount > MAX_ENTRIES) {
                throw new Error(`Zip archive has too many entries (>${MAX_ENTRIES})`);
            }

            const normalized = normalizeEntryPath(entry.fileName);
            if (normalized.startsWith('../') || Path.posix.isAbsolute(normalized)) {
                throw new Error(`Path traversal detected for entry ${entry.fileName}`);
            }

            if (normalized === '__MACOSX' || normalized.startsWith('__MACOSX/')) {
                zipfile.readEntry();
                return;
            }

            const targetPath = Path.join(extractDir, normalized);
            const resolvedTarget = Path.resolve(targetPath);
            if (resolvedTarget !== extractDir && !resolvedTarget.startsWith(rootWithSep)) {
                throw new Error(`Entry resolves outside extraction root: ${entry.fileName}`);
            }

            const mode = entry.externalFileAttributes >>> 16;
            const isSymlink = (mode & 0o170000) === 0o120000;
            if (isSymlink) {
                throw new Error(`Symlink entries are not allowed (${entry.fileName})`);
            }

            if (entry.uncompressedSize > budget.perEntryLimit) {
                throw new Error(`Entry ${entry.fileName} exceeds per-file size limit (${entry.uncompressedSize} bytes)`);
            }
            if (entry.uncompressedSize > budget.remainingBytes) {
                throw new Error('Archive uncompressed size exceeds safety limit');
            }

            const isDirectory = normalized.endsWith('/');
            if (isDirectory) {
                const target = uniquePath(resolvedTarget, true);
                takenPaths.set(target, 'dir');
                await fs.mkdir(target, { recursive: true });
                zipfile.readEntry();
                return;
            }

            const target = uniquePath(resolvedTarget, false);
            takenPaths.set(target, 'file');
            await fs.mkdir(Path.dirname(target), { recursive: true });

            await new Promise<void>((res, rej) => {
                zipfile.openReadStream(entry, (openErr, readStream) => {
                    if (openErr || !readStream) {
                        rej(openErr ?? new Error(`Failed to read entry ${entry.fileName}`));
                        return;
                    }

                    pipeline(readStream, createWriteStream(target, { flags: 'wx' }))
                        .then(() => {
                            budget.remainingBytes -= entry.uncompressedSize;
                            res();
                        })
                        .catch(rej);
                });
            });

            const isZip = normalized.toLowerCase().endsWith('.zip');
            if (isZip) {
                const nestedRel = combineRelPath(relPath, normalized);
                const folderName = Path.basename(normalized);
                const nestedDir = getNextExtractDir(folderName);
                await extractArchiveRecursive({
                    source: { zipPath: target },
                    relPath: nestedRel,
                    extractDir: nestedDir,
                    getNextExtractDir,
                    budget,
                    contexts
                });
                // The nested archive will be rezipped back to target path later
                const ctx = contexts.find((c) => c.relPath === nestedRel);
                if (ctx) {
                    ctx.zipOutputPath = target;
                }
            }

            zipfile.readEntry();
        };

        zipfile.on('entry', (entry) => {
            handleEntry(entry).catch(fail);
        });
        zipfile.on('end', () => succeed());
        zipfile.on('error', (error) => fail(error));
        zipfile.readEntry();
    });
}

// -------- Analysis over extracted data --------

async function analyzeExtractedWorlds(contexts: ArchiveContext[]): Promise<WorldMetadata[]> {
    const worlds: WorldMetadata[] = [];
    for (const ctx of contexts) {
        const worldDirs = await findWorldFolders(ctx.extractDir);
        for (const dir of worldDirs) {
            const relInside = Path.relative(ctx.extractDir, dir).split(Path.sep).join(Path.posix.sep) || '.';
            const worldPath = ctx.relPath ? `${ctx.relPath}/${relInside}` : relInside;
            const meta = await parseWorldMetadataFromDisk(dir, worldPath);
            worlds.push(meta);
        }
    }
    return worlds;
}

async function parseWorldMetadataFromDisk(worldDir: string, relativePath: string): Promise<WorldMetadata> {
    const meta: WorldMetadata = { path: relativePath };
    const levelDatPath = Path.join(worldDir, 'level.dat');
    try {
        const stats = await fs.stat(levelDatPath);
        if (stats.size > MAX_LEVEL_DAT_BYTES) {
            meta.error = `level.dat exceeds size limit (${stats.size} bytes)`;
            return meta;
        }
        const buffer = await fs.readFile(levelDatPath);
        return await parseWorldMetadataFromBuffer(relativePath, buffer);
    } catch (error: any) {
        meta.error = error?.message || 'Failed to parse level.dat';
        return meta;
    }
}

async function parseWorldMetadataFromBuffer(worldPath: string, buffer: Buffer): Promise<WorldMetadata> {
    const meta: WorldMetadata = { path: worldPath };
    try {
        const parsed = await nbt.parse(buffer);
        const data = parsed.parsed as any;
        const dataTag = data?.value?.Data;
        const versionTag = dataTag?.value?.Version;
        const versionName = versionTag?.value?.Name;
        const versionValue = versionName?.value;
        if (typeof versionValue === 'string' && versionValue.trim().length > 0) {
            meta.version = versionValue;
        } else {
            meta.error = 'Invalid version';
        }

        const levelNameTag = dataTag?.value?.LevelName;
        const levelNameValue = levelNameTag?.value;
        if (typeof levelNameValue === 'string' && levelNameValue.trim().length > 0) {
            meta.levelName = levelNameValue;
        }
    } catch (error: any) {
        meta.error = error?.message || 'Failed to parse level.dat';
    }
    return meta;
}

// -------- Optimization --------

async function optimizeWorlds(worlds: WorldMetadata[], contexts: ArchiveContext[]): Promise<void> {
    const worldPathsByRelative = new Map<string, string>(); // relative -> absolute world dir
    for (const ctx of contexts) {
        const worldDirs = await findWorldFolders(ctx.extractDir);
        for (const dir of worldDirs) {
            const relInside = Path.relative(ctx.extractDir, dir).split(Path.sep).join(Path.posix.sep) || '.';
            const key = ctx.relPath ? `${ctx.relPath}/${relInside}` : relInside;
            worldPathsByRelative.set(key, dir);
        }
    }

    for (const world of worlds) {
        const abs = worldPathsByRelative.get(world.path);
        if (!abs) continue;
        await runMcSelector(abs);
    }
}

async function runMcSelector(worldPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const args = ['-jar', MC_SELECTOR_JAR, '--mode', 'delete', '--query', MC_SELECTOR_QUERY, '--world', Path.resolve(worldPath)];
        const proc = spawn('java', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        let stdout = '';
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGKILL');
        }, MC_SELECTOR_TIMEOUT_MS);

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });
        proc.on('error', (error) => { clearTimeout(timer); reject(error); });
        proc.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) return reject(new Error(`Failed to optimize world at ${worldPath}: MCSelector timed out after ${MC_SELECTOR_TIMEOUT_MS}ms`));
            if (code === 0) return resolve();
            const message = stderr.trim() || stdout.trim() || `java exited with code ${code ?? 'unknown'}`;
            reject(new Error(`Failed to optimize world at ${worldPath}: ${message}`));
        });
    });
}

// -------- Repackaging --------

async function repackageArchives(contexts: ArchiveContext[], outputZipPath: string): Promise<void> {
    // Rezip nested archives first (deepest first), then root
    const depth = (relPath: string) => (relPath === '' ? 0 : relPath.split('/').length);
    const sorted = [...contexts].sort((a, b) => depth(b.relPath) - depth(a.relPath));
    for (const ctx of sorted) {
        const targetZip = ctx.relPath === '' ? outputZipPath : ctx.zipOutputPath;
        if (!targetZip) continue;
        await createZipFromDirectory(ctx.extractDir, targetZip);
    }
}

async function createZipFromDirectory(rootDir: string, outputZipPath: string): Promise<void> {
    const rootResolved = Path.resolve(rootDir);
    const entries = await fs.readdir(rootResolved);
    const relativePaths = entries.length === 0 ? ['.'] : entries;

    await fs.mkdir(Path.dirname(outputZipPath), { recursive: true });
    await fs.rm(outputZipPath, { force: true });

    try {
        const zipped = await tryZipBinary(rootResolved, relativePaths, outputZipPath);
        if (!zipped) {
            throw new Error('Unable to create zip: "zip" binary not available in PATH.');
        }
    } catch (error) {
        await fs.rm(outputZipPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

async function tryZipBinary(cwd: string, relativePaths: string[], outputZipPath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        const args = ['-r', '-9', outputZipPath, '--', ...relativePaths];
        const proc = spawn('zip', args, { cwd });
        let stderr = '';
        let stdout = '';
        let handled = false;

        const finish = (fn: () => void) => {
            if (handled) return;
            handled = true;
            fn();
        };

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });
        proc.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return finish(() => resolve(false));
            finish(() => reject(error));
        });
        proc.on('close', (code) => {
            if (code === 0) return finish(() => resolve(true));
            const msg = stderr.trim() || stdout.trim() || `zip exited with code ${code ?? 'unknown'}`;
            finish(() => reject(new Error(msg)));
        });
    });
}

// -------- Read-only analysis (no writes) --------

async function analyzeZipRecursive(source: ZipSource, relPath: string, budget: ExtractionBudget): Promise<WorldMetadata[]> {
    const zipfile = await openZipSource(source);
    const results: WorldMetadata[] = [];

    await new Promise<void>((resolve, reject) => {
        let finished = false;
        let entryCount = 0;

        const fail = (error: unknown) => {
            if (finished) return;
            finished = true;
            zipfile.close();
            reject(error instanceof Error ? error : new Error(String(error)));
        };

        const succeed = () => {
            if (finished) return;
            finished = true;
            zipfile.close();
            resolve();
        };

        const handleEntry = async (entry: yauzl.Entry) => {
            entryCount += 1;
            if (entryCount > MAX_ENTRIES) throw new Error(`Zip archive has too many entries (>${MAX_ENTRIES})`);

            const normalized = normalizeEntryPath(entry.fileName);
            if (normalized.startsWith('../') || Path.posix.isAbsolute(normalized)) {
                throw new Error(`Path traversal detected for entry ${entry.fileName}`);
            }
            if (normalized === '__MACOSX' || normalized.startsWith('__MACOSX/')) {
                zipfile.readEntry();
                return;
            }

            const mode = entry.externalFileAttributes >>> 16;
            const isSymlink = (mode & 0o170000) === 0o120000;
            if (isSymlink) throw new Error(`Symlink entries are not allowed (${entry.fileName})`);

            const isDirectory = normalized.endsWith('/');
            if (isDirectory) {
                zipfile.readEntry();
                return;
            }

            const baseName = Path.posix.basename(normalized).toLowerCase();
            if (baseName === 'level.dat') {
                if (entry.uncompressedSize > budget.perEntryLimit || entry.uncompressedSize > MAX_LEVEL_DAT_BYTES) {
                    throw new Error(`Entry ${entry.fileName} exceeds per-file size limit (${entry.uncompressedSize} bytes)`);
                }
                if (entry.uncompressedSize > budget.remainingBytes) {
                    throw new Error('Archive uncompressed size exceeds safety limit');
                }
                const buffer = await readEntryToBuffer(zipfile, entry, budget);
                const worldDir = Path.posix.dirname(normalized);
                const worldPath = relPath ? `${relPath}/${worldDir || '.'}` : (worldDir || '.');
                const meta = await parseWorldMetadataFromBuffer(worldPath, buffer);
                results.push(meta);
                zipfile.readEntry();
                return;
            }

            if (normalized.toLowerCase().endsWith('.zip')) {
                if (entry.uncompressedSize > budget.perEntryLimit) {
                    throw new Error(`Entry ${entry.fileName} exceeds per-file size limit (${entry.uncompressedSize} bytes)`);
                }
                if (entry.uncompressedSize > budget.remainingBytes) {
                    throw new Error('Archive uncompressed size exceeds safety limit');
                }
                const buffer = await readEntryToBuffer(zipfile, entry, budget);
                const nestedRel = combineRelPath(relPath, normalized);
                const nestedResults = await analyzeZipRecursive({ buffer }, nestedRel, budget);
                results.push(...nestedResults);
                zipfile.readEntry();
                return;
            }

            zipfile.readEntry();
        };

        zipfile.on('entry', (entry) => { handleEntry(entry).catch(fail); });
        zipfile.on('end', () => succeed());
        zipfile.on('error', (error) => fail(error));
        zipfile.readEntry();
    });

    return results;
}

// -------- Shared helpers --------

function combineRelPath(parent: string, child: string): string {
    const cleanChild = child.replace(/\/$/, '');
    return parent ? `${parent}/${cleanChild}` : cleanChild;
}

function normalizeEntryPath(name: string): string {
    // Convert any backslashes to POSIX-style separators before normalizing
    return Path.posix.normalize(name.replace(/\\/g, '/'));
}

function openZipSource(source: ZipSource): Promise<yauzl.ZipFile> {
    const options = { lazyEntries: true, validateEntrySizes: true } as const;
    if (source.zipPath) {
        return new Promise((resolve, reject) => {
            yauzl.open(source.zipPath as string, options, (err, zipfile) => {
                if (err || !zipfile) return reject(err ?? new Error('Unable to open zip file'));
                resolve(zipfile);
            });
        });
    }

    if (source.buffer) {
        return new Promise((resolve, reject) => {
            yauzl.fromBuffer(source.buffer as Buffer, options, (err, zipfile) => {
                if (err || !zipfile) return reject(err ?? new Error('Unable to open zip buffer'));
                resolve(zipfile);
            });
        });
    }

    return Promise.reject(new Error('No zip source provided'));
}

function readEntryToBuffer(zipfile: yauzl.ZipFile, entry: yauzl.Entry, budget: ExtractionBudget): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        zipfile.openReadStream(entry, (openErr, readStream) => {
            if (openErr || !readStream) return reject(openErr ?? new Error(`Failed to read entry ${entry.fileName}`));

            const chunks: Buffer[] = [];
            let total = 0;
            let failed = false;

            const abort = (error: Error) => {
                if (failed) return;
                failed = true;
                readStream.destroy();
                reject(error);
            };

            readStream.on('data', (chunk: Buffer) => {
                total += chunk.length;
                if (total > budget.perEntryLimit || total > budget.remainingBytes) {
                    abort(new Error(`Entry ${entry.fileName} exceeds size limits during read`));
                    return;
                }
                chunks.push(chunk);
            });

            readStream.on('end', () => {
                if (failed) return;
                budget.remainingBytes -= total;
                resolve(Buffer.concat(chunks));
            });

            readStream.on('error', (err) => abort(err instanceof Error ? err : new Error(String(err))));
        });
    });
}

async function findWorldFolders(root: string): Promise<string[]> {
    const rootResolved = Path.resolve(root);
    const pending: string[] = [rootResolved];
    const worlds: string[] = [];

    while (pending.length > 0) {
        const dir = pending.pop() as string;
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const hasLevelDat = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'level.dat');
        if (hasLevelDat) {
            worlds.push(dir);
            continue;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                pending.push(Path.join(dir, entry.name));
            }
        }
    }

    return worlds;
}
