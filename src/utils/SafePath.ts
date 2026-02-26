import Path from 'path';

function isPathContainedIn(parentResolved: string, childResolved: string): boolean {
    if (childResolved === parentResolved) {
        return true;
    }

    const normalizedParent = parentResolved.endsWith(Path.sep) ? parentResolved : `${parentResolved}${Path.sep}`;
    return childResolved.startsWith(normalizedParent);
}

export function safeJoinPath(basePath: string, ...parts: string[]): string {
    let currentPath = Path.normalize(basePath);

    for (const part of parts) {
        currentPath = safeResolvePath(currentPath, part);
    }

    return currentPath;
}

export function safeResolvePath(basePath: string, targetPath: string): string {
    const resolvedBase = Path.resolve(basePath);
    const resolvedTarget = Path.resolve(basePath, targetPath);

    if (!isPathContainedIn(resolvedBase, resolvedTarget)) {
        throw new Error(`Path traversal detected while resolving "${targetPath}" from "${basePath}"`);
    }

    return resolvedTarget;
}

export function safeJoinPathOrNull(basePath: string, ...parts: string[]): string | null {
    try {
        return safeJoinPath(basePath, ...parts);
    } catch {
        return null;
    }
}

export function safeResolvePathOrNull(basePath: string, targetPath: string): string | null {
    try {
        return safeResolvePath(basePath, targetPath);
    } catch {
        return null;
    }
}

export function safeWorkspacePath(pathValue: string): string {
    return safeResolvePath(process.cwd(), pathValue);
}

export function safeWorkspacePathOrNull(pathValue: string): string | null {
    try {
        return safeWorkspacePath(pathValue);
    } catch {
        return null;
    }
}
