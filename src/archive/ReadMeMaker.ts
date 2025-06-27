import { Attachment } from "../submissions/Attachment.js";
import { escapeString } from "../utils/Util.js";
import { ArchiveComment } from "./ArchiveComments.js";
import { ArchiveEntryData } from "./ArchiveEntry.js";

function formatAttachment(attachment: Attachment): string {
    if (attachment.litematic) {
        return `- [${attachment.name}](${encodeURI(attachment.path || '')}): ` + (attachment.litematic.error || `MC ${attachment.litematic.version}, Size ${attachment.litematic.size} blocks`);
    } else if (attachment.contentType === 'mediafire') {
        return `- [${attachment.name}](${attachment.url}): Mediafire link`;
    } else if (attachment.contentType === 'youtube') {
        return `- ${attachment.url}: YouTube video`;
    }

    if (attachment.canDownload && attachment.path) {
        return `- [${attachment.name}](${encodeURI(attachment.path || '')}): ${attachment.contentType}`;
    }

    return `- [${attachment.name}](${attachment.url}): ${attachment.contentType}`;
}

export function makeEntryReadMe(
    entryData: ArchiveEntryData,
    comments: ArchiveComment[]
): string {
    let text = [];
    text.push(`# ${entryData.name}\n`);

    if (entryData.images.length > 0) {
        const image = entryData.images[0];
        text.push(`<img alt="${escapeString(image.name)}" src="${encodeURI(image.path || '')}?raw=1"${(image.height || 200) > 300 ? " height=\"300px\"" : ""}>\n\n`)
    }
    if (entryData.authors.length > 0) {
        text.push(`**Authors:** *${entryData.authors.map(o => o.displayName || o.username).join(", ")}*\n\n`);
    }
    if (entryData.endorsers.length > 0) {
        text.push(`**Endorsed by:** *${entryData.endorsers.map(o => o.displayName || o.username).join(", ")}*\n\n`);
    }
    text.push(`**Tags:** *${entryData.tags.map(o => o.name).join(", ")}*\n`);
    text.push(`\n`);
    text.push(`${entryData.description}\n`);

    if (entryData.features.length > 0) {
        text.push(`\n## Features\n`);
        text.push(entryData.features.map(feature => `- ${feature}`).join('\n') + '\n');
    }

    if (entryData.considerations.length > 0) {
        text.push(`\n## Considerations\n`);
        text.push(entryData.considerations.map(consideration => `- ${consideration}`).join('\n') + '\n');
    }

    if (entryData.notes.length > 0) {
        text.push(`\n## Notes\n`);
        text.push(entryData.notes + '\n');
    }

    if (entryData.images.length > 1) {
        text.push(`\n## Other Images\n`);
        text.push(entryData.images.slice(1).map(image => `<img src="${encodeURI(image.path || '')}?raw=1"${(image.height || 200) > 300 ? " height=\"300px\"" : ""}>`).join('\n\n') + '\n');
    }

    if (entryData.attachments.length > 0) {
        text.push(`\n## Resources\n`);
        text.push(entryData.attachments.map(attachment => {
            return formatAttachment(attachment);
        }).join('\n') + '\n');
    }

    if (comments.length > 0) {
        text.push(`\n## Comments\n`);
        comments.forEach(comment => {
            text.push(`\n### ${comment.sender.displayName || comment.sender.username} (${new Date(comment.timestamp).toLocaleDateString()})\n`);
            text.push(`${comment.content}\n`);

            const imageAttachments = comment.attachments.filter(attachment => attachment.contentType.startsWith('image/'));
            if (imageAttachments.length > 0) {
                text.push(imageAttachments.map(attachment => `<img alt="${escapeString(attachment.name)}" src="${encodeURI(attachment.path || '')}?raw=1" height="150px">`).join('\n\n') + '\n');
            }

            if (comment.attachments.length > imageAttachments.length) {
                text.push(`\n**Other attachments:**\n`);
                text.push(comment.attachments.filter(attachment => !attachment.contentType.startsWith('image/') && attachment.canDownload).map(attachment => {
                    return formatAttachment(attachment);
                }).join('\n') + '\n');
            }
            text.push(`\n`);
        });
    }

    return text.join('');
}