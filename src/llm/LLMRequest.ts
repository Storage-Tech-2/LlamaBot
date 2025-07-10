import { Prompt } from "./prompts/Prompt.js";

/**
 * The LLMRequest class represents a request to a Large Language Model (LLM).
 * It contains a prompt and a priority level for processing.
 * Requests with higher priority are processed before those with lower priority.
 */
export class LLMRequest {
    /**
     * The priority of the request, where higher numbers indicate higher priority.
     */
    private _priority: number = 0;

    /**
     * The prompt for the LLM request.
     */
    private _prompt: Prompt;

    /**
     * The schema for the LLM response.
     * This is a JSON schema string that defines the structure of the response
     */
    private _schema: string = "";


    /**
     * Creates a new LLMRequest instance.
     * @param priority The priority of the request. Higher numbers indicate higher priority.
     * @param prompt The prompt for the LLM request.
     */
    constructor(priority: number, prompt: Prompt, schema: string) {
        this._priority = priority;
        this._prompt = prompt;
        this._schema = schema;
    }

    /**
     * Gets the prompt for the LLM request.
     * @returns The prompt string.
     */
    public get prompt(): Prompt {
        return this._prompt;
    }
    
    /**
     * Gets the schema for the LLM response.
     * @returns The JSON schema string.
     */
    public get schema(): string {
        return this._schema;
    }
    
    /**
     * Gets the priority of the request.
     * @returns The priority number.
     */
    public get priority(): number {
        return this._priority;
    }
}