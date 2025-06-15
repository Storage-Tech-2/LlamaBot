import { Prompt } from "./Prompt";

const prompt_template = `
Create a JSON object containing the name, game version, authors, description, and a list of features extracted from a given text. Cons and notes are optional but should be included if present.

Example:

Input:
**[1.20.3] 2wABt Parallel Red MIS**
*By @RedGrosso, with help from @Walter and @MoonyResearched, based on design by @InspectorTalon and @RaPsCaLLioN1138*

A simple multi-item-sorter storage system.

* Slice is very compact (5x9x2)
* Can sort one item stack every 24gts (up to 21x hopper speed)
* Sorts both 64 & 16 stackables
* Unstackables are sent to their own output

Cons:
* Noisy
* Each category is limited to 1x hopper speed.
* Extremely large, continuous input to a single category can cause items to be incorrectly sent to unsorted.

Additional Credits:
* Chest-Minecart Input: @KikuGie & @Philgoodinator
* Shulker box Unloader: @Christone & @javi
* Cart Yeeter: @C5, @Inspector Talon, et al.

Output:
{
  "name": "2wABt Parallel Red MIS",
  "game_version": "1.20.3",
  "authors": ["@RedGrosso", "@Walter", "@MoonyResearched", "@InspectorTalon", "@RaPsCaLLioN1138"],
  "description": "A simple multi-item-sorter storage system.",
  "features": [
    "Slice is very compact (5x9x2)",
    "Can sort one item stack every 24gts (up to 21x hopper speed)",
    "Sorts both 64 & 16 stackables",
    "Unstackables are sent to their own output",
    "Boxes are automatically unloaded"
  ],
  "cons": [
    "Noisy",
    "Each category is limited to 1x hopper speed.",
    "Extremely large, continuous input to a single category can cause items to be incorrectly sent to unsorted."
  ],
  "notes": "Chest-Minecart Input: @KikuGie & @Philgoodinator. Shulker box Unloader: @Christone & @javi. Cart Yeeter: @C5, @Inspector Talon, et al."
}

Now, extract the JSON object from the following text:
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