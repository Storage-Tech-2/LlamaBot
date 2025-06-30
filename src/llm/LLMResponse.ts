export type LLMResponse = {
    result: {
        description: string; // Description of the device
        features: string[]; // List of features
        cons?: string[]; // List of cons
        notes?: string; // Additional notes
    }
    error?: string; // Error message if any
}