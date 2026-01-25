import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import Path from 'path';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import yauzl from 'yauzl';

const MAX_ENTRY_UNCOMPRESSED_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB per entry to blunt zip bombs
const MAX_TOTAL_UNCOMPRESSED_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB overall limit
const MAX_ENTRIES = 20000;

const MC_SELECTOR_QUERY = 'InhabitedTime = 0 AND !(Palette intersects "observer,repeater,comparator,piston,sticky_piston,redstone_torch,redstone_wire,redstone_wall_torch,hopper,dispenser,dropper,crafter")';
const MC_SELECTOR_JAR = Path.join(process.cwd(), 'java', 'mcaselector-2.6.1.jar');

/**
 * Extracts and optimizes the worlds inside a WDL zip (including nested zips), then repackages everything with maximum compression.
 * Returns the path to the new zip file containing all original files (minus skipped __MACOSX) and optimized worlds.
 */
export async function optimizeWorldDownloads(zipPath: string, tempDir: string): Promise<string> {
    const tempRoot = Path.resolve(tempDir);
    await fs.mkdir(tempRoot, { recursive: true });

    const sessionRoot = Path.join(tempRoot, `wdl-work-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    const extractionRoot = Path.join(sessionRoot, 'extracted');
    await fs.mkdir(extractionRoot, { recursive: true });

    const outputName = `${Path.basename(zipPath, Path.extname(zipPath)) || 'world'}-optimized-${Date.now().toString(36)}.zip`;
    const outputZipPath = Path.join(tempRoot, outputName);
    await fs.rm(outputZipPath, { force: true });

    await fs.access(MC_SELECTOR_JAR).catch(() => {
        throw new Error(`MCSelector jar not found at ${MC_SELECTOR_JAR}`);
    });

    try {
        await extractZipSafely(zipPath, extractionRoot);

        const nestedOptimized = await processNestedZipArchives(extractionRoot, tempRoot);

        const worldFolders = await findWorldFolders(extractionRoot);
        if (worldFolders.length === 0 && !nestedOptimized) {
            throw new Error('No Minecraft world folders (containing level.dat) found in the archive');
        }

        for (const worldFolder of worldFolders) {
            await runMcSelector(worldFolder);
        }

        await createZipFromRoot(extractionRoot, outputZipPath);
        return outputZipPath;
    } finally {
        await fs.rm(sessionRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function extractZipSafely(zipPath: string, destination: string): Promise<void> {
    const destinationRoot = Path.resolve(destination);
    await fs.mkdir(destinationRoot, { recursive: true });

    await new Promise<void>((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true }, (err, zipfile) => {
            if (err || !zipfile) {
                return reject(err ?? new Error('Unable to open zip file'));
            }

            let finished = false;
            let totalUncompressed = 0;
            let entryCount = 0;
            const rootWithSep = destinationRoot.endsWith(Path.sep) ? destinationRoot : `${destinationRoot}${Path.sep}`;

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

            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                entryCount += 1;
                if (entryCount > MAX_ENTRIES) {
                    return fail(new Error(`Zip archive has too many entries (>${MAX_ENTRIES})`));
                }

                const normalized = Path.posix.normalize(entry.fileName);
                if (normalized.startsWith('../') || Path.posix.isAbsolute(normalized)) {
                    return fail(new Error(`Path traversal detected for entry ${entry.fileName}`));
                }

                if (normalized === '__MACOSX' || normalized.startsWith('__MACOSX/')) {
                    zipfile.readEntry();
                    return;
                }

                const targetPath = Path.join(destinationRoot, normalized);
                const resolvedTarget = Path.resolve(targetPath);
                if (resolvedTarget !== destinationRoot && !resolvedTarget.startsWith(rootWithSep)) {
                    return fail(new Error(`Entry resolves outside extraction root: ${entry.fileName}`));
                }

                const mode = entry.externalFileAttributes >>> 16;
                const isSymlink = (mode & 0o170000) === 0o120000;
                if (isSymlink) {
                    return fail(new Error(`Symlink entries are not allowed (${entry.fileName})`));
                }

                if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
                    return fail(new Error(`Entry ${entry.fileName} exceeds per-file size limit (${entry.uncompressedSize} bytes)`));
                }

                if (totalUncompressed + entry.uncompressedSize > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                    return fail(new Error('Archive uncompressed size exceeds safety limit'));
                }

                const isDirectory = normalized.endsWith('/');
                if (isDirectory) {
                    fs.mkdir(resolvedTarget, { recursive: true })
                        .then(() => zipfile.readEntry())
                        .catch(fail);
                    return;
                }

                fs.mkdir(Path.dirname(resolvedTarget), { recursive: true }).then(() => {
                    zipfile.openReadStream(entry, (openErr, readStream) => {
                        if (openErr || !readStream) {
                            return fail(openErr ?? new Error(`Failed to read entry ${entry.fileName}`));
                        }

                        pipeline(readStream, createWriteStream(resolvedTarget))
                            .then(() => {
                                totalUncompressed += entry.uncompressedSize;
                                zipfile.readEntry();
                            })
                            .catch(fail);
                    });
                }).catch(fail);
            });

            zipfile.on('end', () => succeed());
            zipfile.on('error', (error) => fail(error));
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

        entries.forEach((entry) => {
            if (entry.isDirectory()) {
                pending.push(Path.join(dir, entry.name));
            }
        });
    }

    return worlds;
}

async function processNestedZipArchives(root: string, tempRoot: string): Promise<boolean> {
    let foundWorldZip = false;
    const entries = await fs.readdir(root, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name === '__MACOSX') {
            continue;
        }

        const fullPath = Path.join(root, entry.name);
        if (entry.isDirectory()) {
            const nested = await processNestedZipArchives(fullPath, tempRoot);
            foundWorldZip = foundWorldZip || nested;
            continue;
        }

        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.zip')) {
            continue;
        }

        let containsWorld = false;
        try {
            containsWorld = await archiveContainsWorld(fullPath);
        } catch (error: any) {
            throw new Error(`Failed to inspect nested zip ${fullPath}: ${error?.message || String(error)}`);
        }

        if (!containsWorld) {
            continue;
        }

        const optimizedPath = await optimizeWorldDownloads(fullPath, tempRoot);
        await fs.copyFile(optimizedPath, fullPath);
        await fs.rm(optimizedPath, { force: true }).catch(() => undefined);
        foundWorldZip = true;
    }

    return foundWorldZip;
}

async function runMcSelector(worldPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const args = ['-jar', MC_SELECTOR_JAR, '--mode', 'delete', '--query', MC_SELECTOR_QUERY, '--world', worldPath];
        const proc = spawn('java', args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        let stdout = '';
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        proc.on('error', (error) => reject(error));
        proc.on('close', (code) => {
            if (code === 0) {
                return resolve();
            }
            const message = stderr.trim() || stdout.trim() || `java exited with code ${code ?? 'unknown'}`;
            reject(new Error(`Failed to optimize world at ${worldPath}: ${message}`));
        });
    });
}

async function archiveContainsWorld(zipPath: string): Promise<boolean> {
    const absolute = Path.resolve(zipPath);
    return new Promise((resolve, reject) => {
        yauzl.open(absolute, { lazyEntries: true, validateEntrySizes: true }, (err, zipfile) => {
            if (err || !zipfile) {
                return reject(err ?? new Error('Unable to open zip file'));
            }

            let finished = false;
            let entryCount = 0;

            const finish = (value: boolean, error?: unknown) => {
                if (finished) return;
                finished = true;
                zipfile.close();
                if (error) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                    return;
                }
                resolve(value);
            };

            zipfile.readEntry();
            zipfile.on('entry', (entry) => {
                entryCount += 1;
                if (entryCount > MAX_ENTRIES) {
                    return finish(false, new Error(`Zip archive has too many entries (>${MAX_ENTRIES})`));
                }

                const normalized = Path.posix.normalize(entry.fileName);
                if (normalized.startsWith('../') || Path.posix.isAbsolute(normalized)) {
                    return finish(false, new Error(`Path traversal detected for entry ${entry.fileName}`));
                }

                if (normalized === '__MACOSX' || normalized.startsWith('__MACOSX/')) {
                    zipfile.readEntry();
                    return;
                }

                if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
                    return finish(false, new Error(`Entry ${entry.fileName} exceeds per-file size limit (${entry.uncompressedSize} bytes)`));
                }

                if (Path.posix.basename(normalized).toLowerCase() === 'level.dat') {
                    return finish(true);
                }

                zipfile.readEntry();
            });

            zipfile.on('end', () => finish(false));
            zipfile.on('error', (error) => finish(false, error));
        });
    });
}

async function createZipFromRoot(extractionRoot: string, outputZipPath: string): Promise<void> {
    const extractionRootResolved = Path.resolve(extractionRoot);
    const entries = await fs.readdir(extractionRootResolved);
    const relativePaths = entries.length === 0 ? ['.'] : entries;

    await fs.mkdir(Path.dirname(outputZipPath), { recursive: true });
    await fs.rm(outputZipPath, { force: true });

    try {
        const zipped = await tryZipBinary(extractionRootResolved, relativePaths, outputZipPath);
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
        const args = ['-r', '-9', outputZipPath, ...relativePaths];
        const proc = spawn('zip', args, { cwd });
        let stderr = '';
        let stdout = '';
        let handled = false;

        const finish = (fn: () => void) => {
            if (handled) return;
            handled = true;
            fn();
        };

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        proc.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
                return finish(() => resolve(false));
            }
            finish(() => reject(error));
        });
        proc.on('close', (code) => {
            if (code === 0) {
                return finish(() => resolve(true));
            }
            const msg = stderr.trim() || stdout.trim() || `zip exited with code ${code ?? 'unknown'}`;
            finish(() => reject(new Error(msg)));
        });
    });
}
