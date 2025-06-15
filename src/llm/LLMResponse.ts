export type LLMResponse = {
    result: {
        name: string; // Name of the device
        game_version: string; // Game version the device is compatible with
        authors: String[]; // List of authors
        description: string; // Description of the device
        features: string[]; // List of features
        cons?: string[]; // List of cons
        notes?: string; // Additional notes
    }
}