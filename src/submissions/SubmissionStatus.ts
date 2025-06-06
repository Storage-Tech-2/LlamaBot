/**
 * Enum representing the various states a submission can be in during its lifecycle.
 */
export enum SubmissionStatus {
    /**
     * Submission is new, and is awaiting tagging.
     */
    NEW = "new",

    /**
     * Submission is tagged, and is awaiting review. LLM is used to generate machine-readable data.
     */
    REVIEW = "review",

    /**
     * Submission is reviewed, and is awaiting endorsement. At least one expert must endorse the submission.
     */
    ENDORSE = "endorse",

    /**
     * Submission is endorsed, and is being voted on. Votes should not be negative.
     */
    VOTE = "vote",

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