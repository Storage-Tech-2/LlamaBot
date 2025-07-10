import { SubmissionRecords } from "../utils/MarkdownUtils.js";

export type LLMResponse = {
    result: SubmissionRecords;
    error?: string; // Error message if any
}