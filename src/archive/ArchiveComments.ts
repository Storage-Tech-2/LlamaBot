import { Attachment } from "../submissions/Attachment.js";
import { Author } from "../submissions/Author.js";

export type ArchiveComment = {
    id: string; // Unique identifier for the comment
    sender: Author;
    content: string; // The content of the comment
    attachments: Attachment[]; // List of attachments associated with the comment
    timestamp: number; // Timestamp of when the comment was made
}