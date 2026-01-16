
export const Empty = Symbol("Empty");

export class TemporaryCache<T> {
    private cache: T | typeof Empty = Empty;
    private timeoutHandle: NodeJS.Timeout | null = null;
    private durationMs: number;
    private loadFunction: () => Promise<T>;
    private loadingPromise: Promise<T> | null = null;

    constructor(durationMs: number, loadFunction: () => Promise<T>) {
        this.durationMs = durationMs;
        this.loadFunction = loadFunction;
    }

    public async get(): Promise<T> {
        this.resetTimeout();
        if (this.cache !== Empty) {
            return this.cache;
        }

        if (this.loadingPromise !== null) {
            await this.loadingPromise;
            this.resetTimeout();
            if (this.cache !== Empty) {
                return this.cache;
            } else {
                return this.get(); // Retry getting the cache
            }
        }

        this.loadingPromise = this.loadFunction();
        const promise = this.loadingPromise;
        const result = await this.loadingPromise;

        if (this.loadingPromise === promise) {
            this.loadingPromise = null;
            this.cache = result;
            this.resetTimeout();
        }
        return result;
    }

    public set(value: T): void {
        this.cache = value;
        this.resetTimeout();
    }

    public clear(): void {
        this.cache = Empty;
        this.loadingPromise = null;
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
            this.timeoutHandle = null;
        }
    }

    private resetTimeout(): void {
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
        }
        this.timeoutHandle = setTimeout(() => {
            this.clear();
        }, this.durationMs);
    }
}