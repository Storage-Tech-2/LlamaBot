import { Snowflake } from "discord.js"
import { StyleInfo, SubmissionRecords } from "../utils/MarkdownUtils.js";

export enum RevisionType {
    /**
     * This is created by an LLM at the start of a submission.
     */
    Initial = "initial",

    /**
     * This is created by a user manually editing a submission.
     */
    Manual = "manual",

    /**
     * This is created by an LLM when a user requests a revision.
     */
    LLM = "llm",
}

export type Revision = {
    id: Snowflake;
    messageIds: Snowflake[];
    type: RevisionType;

    parentRevision: Snowflake | null;
    timestamp: number;

    records: SubmissionRecords;
    styles: Record<string, StyleInfo>;
}

export type TempRevisionData = {
    name: string;
    minecraftVersion: string;
    authors: string[];
}

export type RevisionReference = {
    id: Snowflake;
    isCurrent: boolean;
}