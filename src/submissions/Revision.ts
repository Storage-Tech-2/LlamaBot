import { Snowflake } from "discord.js"

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
    type: RevisionType;

    parentRevision: Snowflake | null;
    timestamp: number;

    description: string;
    features: string[];
    considerations: string[];
    notes: string;
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