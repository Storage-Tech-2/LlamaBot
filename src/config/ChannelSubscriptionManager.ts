import { Snowflake } from 'discord.js';
import fs from 'fs/promises';
export type ChannelSubscription = {
    code: string;
    subscribedUsers: Snowflake[];
};

export type ChannelSubscriptions = Record<Snowflake, ChannelSubscription>;

export class ChannelSubscriptionManager {
    constructor(private filePath: string) {

    }

    async getSubscriptions(): Promise<ChannelSubscriptions> {
        try {
            const data = await fs.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(data);
            return parsed as ChannelSubscriptions;
        } catch {
            return {};
        }
    }

    async saveSubscriptions(subscriptions: ChannelSubscriptions): Promise<void> {
        try {
            await fs.writeFile(this.filePath, JSON.stringify(subscriptions, null, 2), 'utf-8');
        } catch (err) {
            console.error('Failed to save channel subscriptions:', err);
        }
    }
}
