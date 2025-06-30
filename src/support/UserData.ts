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
}

