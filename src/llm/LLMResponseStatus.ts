/**
 * Enum representing the status of a response from a Large Language Model (LLM).
 */
export enum LLMResponseStatus {
    /**
     * The response is still being generated.
     */
    InProgress = 'in_progress',

    /**
     * The response has been successfully generated.
     */
    Success = 'success',

    /**
     * The response generation failed due to an error.
     */
    Error = 'error',
    
    /**
     * The response generation was cancelled by the user.
     */
    Cancelled = 'cancelled'
}