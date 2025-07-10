import { Revision } from "../../submissions/Revision.js";
import { Prompt } from "./Prompt.js";

export class ModificationPrompt implements Prompt {
    /**
     * The instruction
     */
    private _instruction: string;

    /**
     * The prompt input
     */
    private _input: string;

    /**
     * Creates a new ModificationPrompt instance.
     * @param instruction The instruction for the modification.
     * @param input The input text to modify.
     */
    constructor(instruction: string, revision: Revision) {
        this._instruction = instruction;
        this._input = JSON.stringify(revision.records, null, 2);
    }

    /**
     * Generates the prompt string by replacing the placeholder with the input text.
     * @returns The formatted prompt string.
     */
    public generatePrompt(): string {
        return `Instruction:\n${this._instruction}\nInput:\n${this._input}\nOutput:\n`;
    }

    /**
     * Validates the prompt input.
     * @returns True if the input is valid, false otherwise.
     */
    public validateInput(): boolean | Error {
        // Make sure input is a JSON object
        try {
            JSON.parse(this._input);
        }
        catch (error) {
            return new Error(`Invalid JSON input: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Make sure instruction is not empty
        if (!this._instruction || this._instruction.trim() === "") {
            return new Error("Prompt instruction cannot be empty.");
        }

        // Make sure instruction isn't too long
        if (this._instruction.length > 500) {
            return new Error("Prompt instruction is too long. Maximum length is 500 characters.");
        }

        return true;
    }
}