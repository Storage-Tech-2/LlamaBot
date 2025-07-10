import { Prompt } from "./Prompt.js";

const prompt_template = `
Create a structured JSON object with information from the text below:
{{input}}`;

export class ExtractionPrompt implements Prompt {
    /**
     * The prompt input
     */
    private _input: string;

    /**
     * Creates a new ExtractionPrompt instance.
     * @param input The input text to extract information from.
     */
    constructor(input: string) {
        this._input = input;
    }

    /**
     * Generates the prompt string by replacing the placeholder with the input text.
     * @returns The formatted prompt string.
     */
    public generatePrompt(): string {
        return prompt_template.replace('{{input}}', this._input);
    }

    /**
     * Validates the prompt input.
     * @returns True if the input is valid, false otherwise.
     */
    public validateInput(): boolean | Error {
        // Make sure input is a string and not empty
        if (typeof this._input !== 'string' || this._input.trim() === "") {
            return new Error("Prompt input must be a non-empty string.");
        }

        // Make sure input isn't too long
        if (this._input.length > 5000) { // Arbitrary limit for input length
            return new Error("Prompt input is too long. Maximum length is 5000 characters.");
        }

        return true;
    }
}