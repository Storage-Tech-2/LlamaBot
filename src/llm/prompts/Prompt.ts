
export interface Prompt {
    /**
     * Generates the prompt string.
     * @returns The formatted prompt string.
     */
    generatePrompt(): string;

    /**
     * Validates the prompt input.
     */
    validateInput(): boolean | Error;
}