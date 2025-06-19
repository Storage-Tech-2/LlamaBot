import { Snowflake } from "discord.js";
import { Config } from "../config/ConfigManager";
import { Image } from "./Image";
import { SubmissionStatus } from "./SubmissionStatus";
import { Tag } from "./Tag";
import { RevisionReference } from "./Revision";
import { Attachment } from "./Attachment";
import { Author } from "./Author";
import { DiscordPostReference } from "../archive/ArchiveEntry";

export const SubmissionConfigs = {
    /**
     * Name of the submission
     */
    NAME: new Config<string>("name", ""),

    /**
     * Authors of the submission
     */
    AUTHORS: new Config<Author[] | null>("authors", null),

    /**
     * Submission status
     */
    STATUS: new Config("status", SubmissionStatus.NEW),

    /**
     * Is locked
     */
    IS_LOCKED: new Config<boolean>("is_locked", false),

    /**
     * Lock reason
     */
    LOCK_REASON: new Config<string>("lock_reason", ""),

    /**
     * Is holded
     */
    ON_HOLD: new Config<boolean>("on_holded", false),

    /**
     * Hold reason
     */
    HOLD_REASON: new Config<string>("hold_reason", ""),

    /**
     * Retraction reason
     */
    RETRACTION_REASON: new Config<string>("retraction_reason", ""),

    /**
     * Rejection reason
     */
    REJECTION_REASON: new Config<string>("rejection_reason", ""),

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

    /**
     * Endorers of the submission.
     */
    ENDORSERS: new Config<Author[]>("endorsers", []),

    /**
     * Post
     */
    POST: new Config<DiscordPostReference | null>("post",null)
}