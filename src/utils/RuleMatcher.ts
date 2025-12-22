import { VM } from 'vm2';
import { Submission } from '../submissions/Submission.js';
import { SubmissionConfigs } from '../submissions/SubmissionConfigs.js';
import { splitIntoChunks } from './Util.js';
import { Channel, EmbedBuilder, Snowflake } from 'discord.js';
import { ChannelSubscription, ChannelSubscriptions } from '../config/ChannelSubscriptionManager.js';

export class RuleMatcher {

    static async matchAll(submission: Submission, subscriptions: ChannelSubscriptions): Promise<ChannelSubscriptions> {
        const matchedChannels: Record<Snowflake, ChannelSubscription> = {};

        for (const [channelId, data] of Object.entries(subscriptions)) {
            const code = data.code;
            const logChannel = await submission.getGuildHolder().getGuild().channels.fetch(channelId).catch(() => null);
            if (!logChannel) {
                continue;
            }

            const isMatch = await this.isMatch(submission, code, logChannel).catch(() => false);
            if (isMatch) {
                matchedChannels[channelId] = data;
            }
        }
        return matchedChannels;
    }

    static async isMatch(submission: Submission, code: string, logChannel?: Channel): Promise<boolean> {
        if (!code) {
            return false;
        }

        const name = submission.getConfigManager().getConfig(SubmissionConfigs.NAME);
        const tags = (submission.getConfigManager().getConfig(SubmissionConfigs.TAGS) || []).map(tag => tag.name);
        const currentRevisionID = submission.getRevisionsManager().getCurrentRevision();
        const records = currentRevisionID ? ((await submission.getRevisionsManager().getRevisionById(currentRevisionID.id))?.records ?? {}) : {};
        const archiveChannelID = submission.getConfigManager().getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);

        const guild = submission.getGuildHolder().getGuild();
        const archiveChannel = await guild.channels.fetch(archiveChannelID).catch(() => null);
        const archiveChannelName = archiveChannel ? archiveChannel.name : null;
        const archiveCategory = (archiveChannel && archiveChannel.parent) ? archiveChannel.parent : null;
        const archiveCategoryName = archiveCategory ? archiveCategory.name : null;
        const log: {
            type: 'info' | 'error' | 'warn';
            message: string;
        }[] = [];

        const allContent = {
            ...records,
            name,
            tags,
            channel: archiveChannelName,
            category: archiveCategoryName,
        }

        const vm = new VM({
            timeout: 1000,
            allowAsync: false,
            eval: false,
            wasm: false,

            sandbox: {
                ...allContent,
                log: (...args: any[]) => {
                    log.push({
                        type: 'info',
                        message: args.map(arg => {
                            if (typeof arg === 'string') return arg;
                            try {
                                return JSON.stringify(arg);
                            } catch {
                                return String(arg);
                            }
                        }).join(' ')
                    });
                },
                warn: (...args: any[]) => {
                    log.push({
                        type: 'warn',
                        message: args.map(arg => {
                            if (typeof arg === 'string') return arg;
                            try {
                                return JSON.stringify(arg);
                            } catch {
                                return String(arg);
                            }
                        }).join(' ')
                    });
                },
                match: (toMatch: string | string[] | RegExp | RegExp[]) => {
                    const contentString = JSON.stringify(allContent);
                    const patterns = Array.isArray(toMatch) ? toMatch : [toMatch];
                    for (const pattern of patterns) {
                        if (typeof pattern === 'string') {
                            if (contentString.includes(pattern)) {
                                return true;
                            }
                        } else if (pattern instanceof RegExp) {
                            if (pattern.test(contentString)) {
                                return true;
                            }
                        } else {
                            throw new Error(`Invalid pattern type: ${typeof pattern}`);
                        }
                    }
                    return false;
                }
            }
        });

        let finalResult = false;
        try {
            const result = vm.run(`(() => { ${code} })()`);
            if (typeof result !== 'boolean') {
                log.push({
                    type: 'error',
                    message: `Rule code did not return a boolean value. Returned type: ${typeof result}`
                });
            }

            finalResult = Boolean(result);
        }
        catch (e: any) {
            log.push({
                type: 'error',
                message: `Error while executing rule code: ${e.message}\n${e.stack}`
            });
        }

        if (logChannel && logChannel.isSendable()) {
            for (const item of log) {
                const messageSplit = splitIntoChunks(item.message, 4000);
                for (const messagePart of messageSplit) {
                    const embed = new EmbedBuilder()
                        .setTitle(`Rule Matcher - ${item.type.toUpperCase()}`)
                        .setDescription(messagePart)
                        .setColor(item.type === 'error' ? 0xFF0000 : (item.type === 'warn' ? 0xFFFF00 : 0x00FF00))

                    await logChannel.send({ embeds: [embed] });
                }
            }
        }

        // if there is an error, throw the error
        const errors = log.filter(l => l.type === 'error');
        if (errors.length > 0) {
            const combinedErrors = errors.map(e => e.message).join('\n');
            throw new Error(combinedErrors);
        }

        return finalResult;
    }

}