export class TemporaryCache<T> {
    private cache: T | null = null;
    private timeoutHandle: NodeJS.Timeout | null = null;
    private durationMs: number;
    private loadFunction: () => Promise<T>;

    constructor(durationMs: number, loadFunction: () => Promise<T>) {
        this.durationMs = durationMs;
        this.loadFunction = loadFunction;
    }

    public async get(): Promise<T> {
        if (this.cache !== null) {
            return this.cache;
        }

        this.cache = await this.loadFunction();

        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
        }

        this.timeoutHandle = setTimeout(() => {
            this.cache = null;
            this.timeoutHandle = null;
        }, this.durationMs);

        return this.cache;
    }

    public clear(): void {
        this.cache = null;
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;
        }
    }
}