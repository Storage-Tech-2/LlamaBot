import { Config } from "../config/ConfigManager";
import { SubmissionStatus } from "./SubmissionStatus";

export const SubmissionConfigs = {
    /**
     * Submission status
     */
    STATUS: new Config("status", SubmissionStatus.NEW),

    /**
     * ID of the channel where the submission will be archived.
     */
    ARCHIVE_CHANNEL_ID: new Config("archive_channel_id", ""),

    /**
     * Tags associated with the submission.
     */
    TAGS: new Config("tags", []),

    /**
     * Submission main image
     */
    MAIN_IMAGE: new Config("main_image", null),

    /**
     * Submission attachments
     */
    ATTACHMENTS: new Config("attachments", []),

    /**
     * Submission revisions
     */
    REVISIONS: new Config("revisions", []),

    /**
     * Current revision ID
     */
    CURRENT_REVISION_ID: new Config("current_revision_id", ""),

    /**
     * Status message ID. Used to update the status message in the submission thread.
     */
    STATUS_MESSAGE_ID: new Config("status_message_id", ""),
}