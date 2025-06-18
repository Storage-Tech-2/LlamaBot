export class Lock {
    private _locked: boolean;
    private _waiting: Array<() => void>;

    constructor() {
        this._locked = false;
        this._waiting = [];
    }

    acquire(): Promise<void> {
        return new Promise((resolve) => {
            if (!this._locked) {
                this._locked = true;
                resolve();
            } else {
                this._waiting.push(resolve);
            }
        });
    }

    release(): void {
        if (this._waiting.length > 0) {
            const nextResolve = this._waiting.shift();
            if (nextResolve) {
                nextResolve();
            }
        } else {
            this._locked = false;
        }
    }
}