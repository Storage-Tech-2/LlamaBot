import { Snowflake } from "discord.js";
import { Config } from "../config/ConfigManager";
import { Image } from "./Image";
import { SubmissionStatus } from "./SubmissionStatus";
import { Tag } from "./Tag";
import { Revision, RevisionReference } from "./Revision";
import { Attachment } from "./Attachment";

export const SubmissionConfigs = {
    /**
     * Submission status
     */
    STATUS: new Config("status", SubmissionStatus.NEW),

    /**
     * ID of the submission thread.
     */
    SUBMISSION_THREAD_ID: new Config<Snowflake>("submission_channel_id", ""),

    /**
     * URL of the submission thread.
     */
    SUBMISSION_THREAD_URL: new Config<string>("submission_thread_url", ""),

    /**
     * ID of the channel where the submission will be archived.
     */
    ARCHIVE_CHANNEL_ID: new Config<Snowflake>("archive_channel_id", ""),
   
    /**
     * Tags associated with the submission.
     */
    TAGS: new Config<Tag[] | null>("tags", null),

    /**
     * Submission images
     */
    IMAGES: new Config<Image[] | null>("images", null),

    /**
     * Submission attachments
     */
    ATTACHMENTS: new Config<Attachment[] | null>("attachments", null),

    /**
     * Submission revisions
     */
    REVISIONS: new Config<RevisionReference[]>("revisions", []),

    /**
     * Status message ID. Used to update the status message in the submission thread.
     */
    STATUS_MESSAGE_ID: new Config<Snowflake>("status_message_id", ""),
}