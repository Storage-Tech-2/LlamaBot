import { LLMRequest } from "./LLMRequest"

export type LLMRequestAndPromise = {
    /**
     * The priority of the request, where higher numbers indicate higher priority.
     */
    request: LLMRequest;

    /**
     * The promise that resolves when the request is processed.
     */
    resolve: (value: any) => void;

    /**
     * The promise that rejects if the request fails.
     */
    reject: (reason?: any) => void;
}