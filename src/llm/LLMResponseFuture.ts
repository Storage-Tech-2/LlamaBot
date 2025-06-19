import { LLMResponse } from "./LLMResponse.js";
import { LLMResponseStatus } from "./LLMResponseStatus.js";

export class LLMResponseFuture {
    status: LLMResponseStatus;
    promise?: Promise<void>;
    result?: any;
    error?: Error;

    constructor(promise: Promise<LLMResponse>) {
        this.status = LLMResponseStatus.InProgress;
        this.promise = promise.then((response) => {
            this.status = LLMResponseStatus.Success;
            this.promise = undefined; // Clear the promise after resolution
            this.result = response;
        }).catch((error) => {
            this.status = LLMResponseStatus.Error;
            this.error = error;
            this.promise = undefined; // Clear the promise after rejection
        });
    }

    public async getResponse(): Promise<LLMResponse> {
        if (this.promise) {
            await this.promise;
        }

        switch (this.status) {
            case LLMResponseStatus.InProgress:
                throw new Error("Response is still in progress");
            case LLMResponseStatus.Success:
                return this.result;
            case LLMResponseStatus.Error:
                throw this.error || new Error("An error occurred while processing the response");
            case LLMResponseStatus.Cancelled:
                throw new Error("Response was cancelled");
            default:
                throw new Error("Unknown response status");
        }
    }

    public getResponseNow(): LLMResponse | null {
        if (this.status === LLMResponseStatus.Success) {
            return this.result || null;
        }
        return null;
    }

    public getStatus(): LLMResponseStatus {
        return this.status;
    }

    public getError(): Error | undefined {
        return this.error;
    }
}