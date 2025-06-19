/**
 * Enum representing the various states a submission can be in during its lifecycle.
 */
export enum SubmissionStatus {
    /**
     * Submission is new, and is awaiting processing.
     */
    NEW = "new",

    /**
     * Submission is completed, but needs endorser's confirmation.
     */
    NEED_ENDORSEMENT = "need_endorsement",
    
    /**
     * Submission is waiting for author's confirmation.
     */
    WAITING = "waiting",

    /**
     * Submission has been accepted, and is now in the database.
     */
    ACCEPTED = "accepted",

    /**
     * Submission has been rejected, and is not in the database.
     */
    REJECTED = "rejected",

    /**
     * Submission is retracted
     * This is used when a submission is retracted by the user or the system.
     */
    RETRACTED = "retracted",
}