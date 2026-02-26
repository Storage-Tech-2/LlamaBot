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
    let currentResolved = Path.resolve(currentPath);

    for (const part of parts) {
        const nextPath = Path.join(currentPath, part);
        const nextResolved = Path.resolve(nextPath);

        if (!isPathContainedIn(currentResolved, nextResolved)) {
            throw new Error(`Path traversal detected while joining "${part}" to "${currentPath}"`);
        }

        currentPath = nextPath;
        currentResolved = nextResolved;
    }

    return currentPath;
}

export function safeJoinPathOrNull(basePath: string, ...parts: string[]): string | null {
    try {
        return safeJoinPath(basePath, ...parts);
    } catch {
        return null;
    }
}
