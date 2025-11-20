import { Snowflake } from "discord.js"

export type ThankEntry = {
    channelId: Snowflake;
    messageId: Snowflake;
    thankedBy: Snowflake;
    timestamp: number;
}

export enum AttachmentsState {
    DISALLOWED = "disallowed",
    WARNED = "warned",
    FAILED = "failed",
    ALLOWED = "allowed",
}

export type UserData = {
    id: Snowflake;
    username: string;

    thankedCountTotal: number;
    thankedBuffer: ThankEntry[];
    disableRole: boolean;

    lastThanked?: number; // Timestamp of the last thanked message

    archivedPosts?: Snowflake[]; // List of archived post IDs

    attachmentsAllowedState?: AttachmentsState;

    messagesToDeleteOnTimeout?: Snowflake[]; // List of message IDs to delete
}

