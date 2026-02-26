import { Snowflake } from 'discord.js';
import fs from 'fs/promises';
import { safeWorkspacePath } from '../utils/SafePath.js';
export type UserSubscriptions = Record<Snowflake, Snowflake[]>;

export class UserSubscriptionManager {
    constructor(private filePath: string) {
        this.filePath = safeWorkspacePath(filePath);
    }

    async getSubscriptions(): Promise<UserSubscriptions> {
        try {
            const data = await fs.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(data);
            return parsed as UserSubscriptions;
        } catch {
            return {};
        }
    }

    async saveSubscriptions(subscriptions: UserSubscriptions): Promise<void> {
        try {
            await fs.writeFile(this.filePath, JSON.stringify(subscriptions, null, 2), 'utf-8');
        } catch (err) {
            console.error('Failed to save subscriptions:', err);
        }
    }

    async getSubscribersForChannel(channelId: Snowflake): Promise<Snowflake[]> {
        const subs = await this.getSubscriptions();
        return subs[channelId] ?? [];
    }

    async subscribeUserTo(userId: Snowflake, channelIds: Snowflake[]): Promise<number> {
        const subs = await this.getSubscriptions();
        let subscribedCount = 0;

        for (const channelId of channelIds) {
            if (!subs[channelId]) {
                subs[channelId] = [];
            }
            if (!subs[channelId].includes(userId)) {
                subs[channelId].push(userId);
                subscribedCount++;
            }
        }
        if (subscribedCount > 0) {
            await this.saveSubscriptions(subs);
        }
        return subscribedCount;
    }

    async unsubscribeUserFrom(userId: Snowflake, channelIds: Snowflake[]): Promise<number> {
        const subs = await this.getSubscriptions();
        let unsubscribedCount = 0;

        for (const channelId of channelIds) {
            if (subs[channelId]) {
                const before = subs[channelId].length;
                subs[channelId] = subs[channelId].filter(id => id !== userId);
                const after = subs[channelId].length;

                if (before !== after) {
                    unsubscribedCount++;
                }

                if (subs[channelId].length === 0) {
                    delete subs[channelId];
                }
            }
        }
        if (unsubscribedCount > 0) {
            await this.saveSubscriptions(subs);
        }
        return unsubscribedCount;
    }

    async unsubscribeUserFromAll(userId: Snowflake): Promise<number> {
        const subs = await this.getSubscriptions();
        let unsubscribedCount = 0;

        for (const channelId in subs) {
            if (subs[channelId].includes(userId)) {
                subs[channelId] = subs[channelId].filter(id => id !== userId);
                unsubscribedCount++;

                if (subs[channelId].length === 0) {
                    delete subs[channelId];
                }
            }
        }
        if (unsubscribedCount > 0) {
            await this.saveSubscriptions(subs);
        }
        return unsubscribedCount;
    }
}
