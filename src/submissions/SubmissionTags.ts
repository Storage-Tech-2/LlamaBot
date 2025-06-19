import { GuildForumTag } from "discord.js";

export const SubmissionTags: GuildForumTag[] = [
    {
        name: "New",
        emoji: { name: '🆕' },
        moderated: true
    },
    {
        name: "Need Endorsement",
        emoji: { name: '🔖' },
        moderated: true
    },
    {
        name: "Waiting",
        emoji: { name: '⏳' },
        moderated: true
    },
    {
        name: "Published",
        emoji: { name: '📢' },
        moderated: true
    },
    {
        name: "Rejected",
        emoji: { name: '🚫' },
        moderated: true
    },
    {
        name: "Retracted",
        emoji: { name: '❌' },
        moderated: true
    },
    {
        name: "On Hold",
        emoji: { name: '⏸️' },
        moderated: true
    },
    {
        name: "Locked",
        emoji: { name: '🔒' },
        moderated: true
    }
] as GuildForumTag[];

export const SubmissionTagNames = {
    NEW: "New",
    NEED_ENDORSEMENT: "Need Endorsement",
    WAITING_FOR_PUBLICATION: "Waiting",
    PUBLISHED: "Published",
    REJECTED: "Rejected",
    RETRACTED: "Retracted",
    ON_HOLD: "On Hold",
    LOCKED: "Locked"
}

export function getTagByName(name: string): GuildForumTag {
    const tag = SubmissionTags.find(tag => tag.name === name);
    if (!tag) {
        throw new Error(`Tag with name "${name}" not found`);
    }
    return tag;
}