import { Snowflake } from "discord.js"

export type ThankEntry = {
    channelId: Snowflake;
    messageId: Snowflake;
    thankedBy: Snowflake;
    timestamp: number;
}

export type UserData = {
    id: Snowflake;
    username: string;

    thankedCountTotal: number;
    thankedBuffer: ThankEntry[];
    disableRole: boolean;

    lastThanked?: number; // Timestamp of the last thanked message

    archivedPosts?: Snowflake[]; // List of archived post IDs
}

