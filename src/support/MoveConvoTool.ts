import { Snowflake } from "discord.js"
import { Bot } from "../Bot.js";

export type MoveConvoData = {
    userId: Snowflake;
    channelId: Snowflake;
    startMessageId?: Snowflake;
    endMessageId?: Snowflake;
    moveToChannelId?: Snowflake;
    toMoveMessageIds: Snowflake[];
    movedMessageIds: Snowflake[];
    statusMessages: Snowflake[];
}

export function getOrMakeMoveConvoData(bot: Bot, userId: Snowflake, channelId: Snowflake): MoveConvoData {
    let data = getMoveConvoData(bot, userId, channelId);
    if (!data) {
        data = {
            userId,
            channelId,
            toMoveMessageIds: [],
            movedMessageIds: [],
            statusMessages: []
        };
        saveMoveConvoData(bot, data);
    }
    return data;
}

export function getMoveConvoData(bot: Bot, userId: Snowflake, channelId: Snowflake): MoveConvoData | undefined {
    const tempDataStore = bot.getTempDataStore();
    const key = `move-convo-${userId}-${channelId}`;
    let data = tempDataStore.getEntry(key) as MoveConvoData | undefined;
    return data;
}


export function saveMoveConvoData(bot: Bot, data: MoveConvoData): void {
    const tempDataStore = bot.getTempDataStore();
    const key = `move-convo-${data.userId}-${data.channelId}`;
    tempDataStore.addEntry(key, data, 15 * 60 * 1000); // 15 minutes
}

export function removeMoveConvoData(bot: Bot, userId: Snowflake, channelId: Snowflake): void {
    const tempDataStore = bot.getTempDataStore();
    const key = `move-convo-${userId}-${channelId}`;
    tempDataStore.removeEntry(key);
}