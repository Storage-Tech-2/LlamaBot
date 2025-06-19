import { Snowflake } from "discord.js";
import { Submission } from "./Submission.js";
import { SubmissionConfigs } from "./SubmissionConfigs.js";
import { Revision, RevisionReference } from "./Revision.js";
import fs from "fs/promises";
import path from "path";
import { RevisionEmbed } from "../embed/RevisionEmbed.js";

export class RevisionManager {
    submission: Submission;
    revisionsFolder: string;

    constructor(submission: Submission, revisionsFolder: string) {
        this.submission = submission;
        this.revisionsFolder = revisionsFolder;
    }

    public getRevisionsList(): RevisionReference[] {
        return this.submission.getConfigManager().getConfig(SubmissionConfigs.REVISIONS);
    }

    public async getRevisionById(id: Snowflake): Promise<Revision | null> {
        try {
            const filePath = path.join(this.revisionsFolder, `${id}.json`);
            const data = await fs.readFile(filePath, 'utf-8');
            const revision: Revision = JSON.parse(data);
            return revision;
        } catch (error) {
            console.error(`Failed to read revision ${id}:`, error);
            return null;
        }
    }

    public async createRevision(revision: Revision): Promise<Revision> {

        const filePath = path.join(this.revisionsFolder, `${revision.id}.json`);

        // if the folder doesn't exist, create it
        if (!await fs.access(this.revisionsFolder).then(() => true).catch(() => false)) {
            await fs.mkdir(this.revisionsFolder, { recursive: true });
        }

        // Write the revision to the file
        await fs.writeFile(filePath, JSON.stringify(revision, null, 2), 'utf-8');

        const revisionsList = this.getRevisionsList();
        const reference: RevisionReference = {
            id: revision.id,
            isCurrent: false
        }
        revisionsList.push(reference);
        this.submission.getConfigManager().setConfig(SubmissionConfigs.REVISIONS, revisionsList);

        return revision;
    }

    public async setCurrentRevision(id: Snowflake, updateCurrent: boolean = true) {
        const revisionsList = this.getRevisionsList();
        const oldCurrentRevisions = revisionsList.filter(r => r.isCurrent);
        const channel = await this.submission.getSubmissionChannel();
            
        await Promise.all(oldCurrentRevisions.map(async (revision) => {
            const revisionData = await this.getRevisionById(revision.id);
            if (!revisionData) return;
            const message = await channel.messages.fetch(revisionData.id);
            if (message) {
                const embed = await RevisionEmbed.create(this.submission, revisionData, false);
                await message.edit({
                    embeds: [embed.getEmbed()],
                    components: [embed.getRow() as any]
                });
            }
        }));

        for (const revision of revisionsList) {
            revision.isCurrent = (revision.id === id);
        }
        this.submission.getConfigManager().setConfig(SubmissionConfigs.REVISIONS, revisionsList);

        if (updateCurrent) {
            const revisionData = await this.getRevisionById(id);
            if (!revisionData) return;
            const message = await channel.messages.fetch(revisionData.id);
            if (message) {
                const embed = await RevisionEmbed.create(this.submission, revisionData, true);
                await message.edit({
                    embeds: [embed.getEmbed()],
                    components: [embed.getRow() as any]
                });
            }
        }   
    }

    public isRevisionCurrent(id: Snowflake): boolean {
        const revisionsList = this.getRevisionsList();
        const revision = revisionsList.find(r => r.id === id);
        return revision ? revision.isCurrent : false;
    }

    public getCurrentRevision(): RevisionReference | null {
        const revisionsList = this.getRevisionsList();
        const currentRevision = revisionsList.find(r => r.isCurrent);
        if (!currentRevision) return null;
        return currentRevision;
    }
}