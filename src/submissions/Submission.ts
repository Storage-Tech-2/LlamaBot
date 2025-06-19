import { ActionRowBuilder, Message, MessageFlags, MessageReferenceType, Snowflake, TextThreadChannel } from "discord.js";
import { GuildHolder } from "../GuildHolder";
import { ConfigManager } from "../config/ConfigManager";
import Path from "path";
import { SubmissionConfigs } from "./SubmissionConfigs";
import { StarterEmbed } from "../embed/StarterEmbed";
import { LLMResponseFuture } from "../llm/LLMResponseFuture";
import { LLMResponseStatus } from "../llm/LLMResponseStatus";
import { LLMRequest } from "../llm/LLMRequest";
import { ExtractionPrompt } from "../llm/prompts/ExtractionPrompt";
import { getAllAttachments, processAttachments, processImages } from "../utils/Util";
import { Attachment } from "./Attachment";
import { RevisionManager } from "./RevisionManager";
import { Revision, RevisionType } from "./Revision";
import { RevisionEmbed } from "../embed/RevisionEmbed";
import { ModificationPrompt } from "../llm/prompts/ModificationPrompt";
import { SubmissionStatus } from "./SubmissionStatus";
import { PublishButton } from "../components/buttons/PublishButton";

export class Submission {
    private guildHolder: GuildHolder;
    private id: Snowflake;
    private folderPath: string;
    private config: ConfigManager;
    private revisions: RevisionManager;
    private extractionResults?: LLMResponseFuture;
    private llmReviseResponse?: LLMResponseFuture;
    public lastAccessed: number = Date.now();
    private cachedAttachments?: Attachment[];
    public imagesProcessing: boolean = false;
    public attachmentsProcessing: boolean = false;
    private reviewLocked: boolean = false;

    private publishLock: boolean = false;

    constructor(
        guildHolder: GuildHolder,
        id: Snowflake,
        folderPath: string,
    ) {
        this.guildHolder = guildHolder;
        this.id = id;
        this.folderPath = folderPath;
        this.config = new ConfigManager(Path.join(folderPath, 'submission.json'));
        this.revisions = new RevisionManager(this, Path.join(folderPath, 'revisions'));
    }

    /**
     * Called when the submission is created from nothing
     */
    public async init() {
        // Set initial config values
        const channel = await this.getSubmissionChannel();
        this.config.setConfig(SubmissionConfigs.NAME, channel.name);
        this.config.setConfig(SubmissionConfigs.SUBMISSION_THREAD_ID, channel.id);
        this.config.setConfig(SubmissionConfigs.SUBMISSION_THREAD_URL, channel.url);
        this.config.setConfig(SubmissionConfigs.STATUS, SubmissionConfigs.STATUS.default);

        await this.checkStatusMessage();
        this.checkLLMExtraction();
    }

    public async getSubmissionChannel(): Promise<TextThreadChannel> {
        const channel = await this.guildHolder.getGuild().channels.fetch(this.id);
        if (!channel) {
            throw new Error('Channel not found')
        }
        return channel as TextThreadChannel;
    }

    public async checkStatusMessage() {
        const statusMessageId = this.config.getConfig(SubmissionConfigs.STATUS_MESSAGE_ID);
        if (!statusMessageId) {
            // post initial message
            const starterEmbed = await StarterEmbed.create(this);
            const channel = await this.getSubmissionChannel();
            const message = await channel.send({ embeds: [starterEmbed.getEmbed()], components: [starterEmbed.getRow() as any] })
            message.pin()
            this.config.setConfig(SubmissionConfigs.STATUS_MESSAGE_ID, message.id);
        }
    }

    public async checkLLMExtraction() {
        // If we already have extraction results, no need to check again
        if (this.extractionResults) {
            return;
        }

        // check if revisions exist. no need to extract if revisions are present
        const revisions = this.getRevisionsManager().getRevisionsList();
        if (revisions.length > 0) {
            return;
        }

        const channel = await this.getSubmissionChannel();
        const message = await channel.fetchStarterMessage();
        if (!message) {
            throw new Error('Starter message not found');
        }

        // If we already have extraction results, no need to check again
        if (this.extractionResults) {
            return;
        }

        // check if revisions exist. no need to extract if revisions are present
        if (revisions.length > 0) {
            return;
        }

        // If no revisions, we can start the extraction process
        const prompt = new ExtractionPrompt(message.content)
        const request = new LLMRequest(1, prompt);
        this.extractionResults = this.guildHolder.getBot().llmQueue.addRequest(request);

        try {
            await this.extractionResults.getResponse();
        } catch (error) {
            console.error('Error getting LLM response:', error);
        }

        this.checkReview();
    }

    public isPublishable(): boolean {
        const authors = this.config.getConfig(SubmissionConfigs.AUTHORS);
        const archiveChannelId = this.config.getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        const submissionTags = this.config.getConfig(SubmissionConfigs.TAGS);
        const mainImages = this.config.getConfig(SubmissionConfigs.IMAGES);
        const attachments = this.config.getConfig(SubmissionConfigs.ATTACHMENTS);

        if (authors === null || !archiveChannelId || submissionTags == null || mainImages === null || attachments === null) {
            // If any of the required fields are missing, we cannot proceed
            return false;
        }

        const current = this.getRevisionsManager().getCurrentRevision();
        if (!current) {
            // If there is no current revision, we cannot proceed
            return false;
        }

        // check endorsers
        const endorsers = this.config.getConfig(SubmissionConfigs.ENDORSERS);
        if (endorsers.length === 0) {
            // If there are no endorsers, we cannot proceed
            return false;
        }

        return true; // All conditions met, submission is publishable
    }

    public async checkReview() {
        const authors = this.config.getConfig(SubmissionConfigs.AUTHORS);
        const archiveChannelId = this.config.getConfig(SubmissionConfigs.ARCHIVE_CHANNEL_ID);
        const submissionTags = this.config.getConfig(SubmissionConfigs.TAGS);
        const mainImages = this.config.getConfig(SubmissionConfigs.IMAGES);
        const attachments = this.config.getConfig(SubmissionConfigs.ATTACHMENTS);

        if (authors === null || !archiveChannelId || submissionTags == null || mainImages === null || attachments === null) {
            // If any of the required fields are missing, we cannot proceed
            return;
        }

        const revisions = this.getRevisionsManager().getRevisionsList();
        if (revisions.length > 0) {
            console.warn('Revisions exist, skipping extraction');
            return;
        }

        if (!this.extractionResults || this.extractionResults.getStatus() === LLMResponseStatus.InProgress) {
            return; // Wait for extraction to complete
        }

        if (this.reviewLocked) {
            return; // Prevent multiple submissions
        }

        this.reviewLocked = true; // Lock the review process to prevent multiple submissions
        try {
            const initialRevision = await this.getInitialRevision();

            const embed = await RevisionEmbed.create(this, initialRevision, true);
            const channel = await this.getSubmissionChannel();
            const message = await channel.send({ embeds: [embed.getEmbed()], components: [embed.getRow() as any] });

            initialRevision.id = message.id; // Set the message ID as the revision ID

            await this.getRevisionsManager().createRevision(initialRevision);
            this.getRevisionsManager().setCurrentRevision(initialRevision.id);
        } catch (error) {
            console.error('Error creating initial revision:', error);
        }
        this.reviewLocked = false; // Unlock the review process
    }

    public async getInitialRevision(): Promise<Revision> {

        if (this.extractionResults && this.extractionResults.getStatus() === LLMResponseStatus.Success) {

            const response = this.extractionResults.getResponseNow();
            if (!response) {
                throw new Error('No response from LLM extraction');
            }

            const revision: Revision = {
                id: '',
                type: RevisionType.Initial,
                parentRevision: null,
                timestamp: Date.now(),
                description: response.result.description,
                features: response.result.features,
                considerations: response.result.cons || [],
                notes: response.result.notes || ''
            }
            return revision;
        } else {
            // If extraction results are not available, we create a default revision
            // get initial message from the submission thread
            const channel = await this.getSubmissionChannel();
            const message = await channel.fetchStarterMessage();
            if (!message) {
                throw new Error('Starter message not found');
            }

            const revision: Revision = {
                id: '',
                type: RevisionType.Initial,
                parentRevision: null,
                timestamp: Date.now(),
                description: message.content,
                features: [],
                considerations: [],
                notes: ''
            }
            return revision;
        }
    }

    public async processImages() {
        if (this.imagesProcessing) {
            console.error('Images are already being processed');
            return;
        }
        this.imagesProcessing = true;
        try {
            const images = this.config.getConfig(SubmissionConfigs.IMAGES) || [];
            const processedFolder = this.getProcessedImagesFolder();
            const downloadFolder = Path.join(this.folderPath, 'downloaded_images');
            await processImages(images, downloadFolder, processedFolder);
            this.imagesProcessing = false;
        } catch (error) {
            this.imagesProcessing = false;
            console.error('Error processing images:', error);
            throw error;
        }
    }

    public async processAttachments() {
        if (this.attachmentsProcessing) {
            console.error('Attachments are already being processed');
            return;
        }
        this.attachmentsProcessing = true;
        try {
            const attachments = this.config.getConfig(SubmissionConfigs.ATTACHMENTS) || [];
            const attachmentsFolder = this.getAttachmentFolder();
            await processAttachments(attachments, attachmentsFolder);
            this.attachmentsProcessing = false;
        } catch (error) {
            this.attachmentsProcessing = false;
            console.error('Error processing attachments:', error);
            throw error;
        }
    }

    public getProcessedImagesFolder(): string {
        return Path.join(this.folderPath, 'processed_images');
    }

    public getAttachmentFolder(): string {
        return Path.join(this.folderPath, 'attachments');
    }



    public async statusUpdated() {
        const statusMessageId = this.config.getConfig(SubmissionConfigs.STATUS_MESSAGE_ID);
        if (!statusMessageId) {
            throw new Error('Status message not sent yet!');
        }

        const channel = await this.getSubmissionChannel();
        const message = await channel.messages.fetch(statusMessageId);

        if (!message) {
            throw new Error('Status message not found');
        }

        const starterEmbed = await StarterEmbed.create(this);
        await message.edit({ embeds: [starterEmbed.getEmbed()], components: [starterEmbed.getRow() as any] });

        if (this.isPublishable()) {
            const status = this.config.getConfig(SubmissionConfigs.STATUS);
            if (status === SubmissionStatus.NEW) {
                this.config.setConfig(SubmissionConfigs.STATUS, SubmissionStatus.WAITING);

                const publishButton = await new PublishButton().getBuilder(false);

                channel.send({
                    content: `<@${channel.ownerId}> Congratulations! Your submission is now ready to be published! Click the button below to proceed.`,
                    components: [(new ActionRowBuilder().addComponents(publishButton)) as any]
                });
            }
        }
    }

    public async handleMessage(message: Message) {
        this.checkLLMExtraction();
        if (message.reference && message.reference.type === MessageReferenceType.Default) {
            // its a reply
            await this.handleReplies(message);
        }
    }

    async handleReplies(message: Message) {
        // Make sure it isn't bot
        if (message.author.bot || message.reference?.messageId === undefined) {
            return
        }

        // Check if message id is in revisions
        const revisions = this.getRevisionsManager().getRevisionsList();
        if (!revisions.some(r => r.id === message.reference?.messageId)) {
            return;
        }

        // It's a reply to the bot for a revision
        const revision = await this.getRevisionsManager().getRevisionById(message.reference.messageId)
        if (!revision) {
            console.error('Revision not found', message.reference.messageId)
            return
        }

        if (this.llmReviseResponse && this.llmReviseResponse.getStatus() === LLMResponseStatus.InProgress) {
            console.log('LLM revise promise already in progress')
            message.reply('Revision already in progress, please wait')
            return
        }

        const wmsg = await message.reply('Processing revision, please wait')

        this.llmReviseResponse = this.useLLMRevise(message.content, revision)

        let response
        try {
            response = await this.llmReviseResponse.getResponse();
            await wmsg.delete()
        } catch (error) {
            console.error('Error using LLM:', error)
            await message.reply('Error using LLM, please check the logs')
            this.llmReviseResponse = undefined;
            return
        }

        this.llmReviseResponse = undefined;

        const isCurrent = this.getRevisionsManager().isRevisionCurrent(revision.id);

        const newRevisionData: Revision = {
            id: "",
            type: RevisionType.LLM,
            parentRevision: revision.id,
            timestamp: Date.now(),
            description: response.result.description,
            features: response.result.features,
            considerations: response.result.cons || [],
            notes: response.result.notes || ""
        }

        await message.reply({
            content: `<@${message.author.id}> I've edited the submission${isCurrent ? ' and set it as current' : ''}`
        })

        const embed = await RevisionEmbed.create(this, newRevisionData, isCurrent);
        const messageNew = await message.reply({
            embeds: [embed.getEmbed()],
            components: [embed.getRow() as any],
            flags: MessageFlags.SuppressNotifications
        })
        newRevisionData.id = messageNew.id;
        await this.getRevisionsManager().createRevision(newRevisionData);
        if (isCurrent) {
            await this.getRevisionsManager().setCurrentRevision(newRevisionData.id, false);
        }
        this.statusUpdated();
    }

    setLock(locked: boolean) {
        this.config.setConfig(SubmissionConfigs.IS_LOCKED, locked);
    }

    setHold(hold: boolean) {
        this.config.setConfig(SubmissionConfigs.ON_HOLD, hold);
    }

    useLLMRevise(prompt: string, revision: Revision): LLMResponseFuture {
        // request llm response
        const llmPrompt = new ModificationPrompt(
            prompt,
            revision
        )
        const request = new LLMRequest(1, llmPrompt);
        return this.guildHolder.getBot().llmQueue.addRequest(request);
    }


    public updateLastAccessed() {
        this.lastAccessed = Date.now();
    }

    public async load() {
        await this.config.loadConfig();
    }

    public async save() {
        await this.config.saveConfig();
    }

    public canJunk(): boolean {
        if (this.extractionResults && this.extractionResults.getStatus() === LLMResponseStatus.InProgress) {
            return false; // Cannot junk while LLM response is in progress
        }

        if (this.llmReviseResponse && this.llmReviseResponse.getStatus() === LLMResponseStatus.InProgress) {
            return false; // Cannot junk while LLM revise response is in progress
        }

        if (this.imagesProcessing) {
            return false; // Cannot junk while images are being processed
        }

        if (this.attachmentsProcessing) {
            return false; // Cannot junk while attachments are being processed
        }

        return true;
    }

    public getId(): Snowflake {
        return this.id;
    }

    public getConfigManager(): ConfigManager {
        return this.config;
    }

    async getAttachments() {
        if (this.cachedAttachments) {
            return this.cachedAttachments
        }
        const channel = await this.getSubmissionChannel();
        const attachments = await getAllAttachments(channel)
        this.cachedAttachments = attachments

        setTimeout(() => {
            this.cachedAttachments = undefined;
        }, 5000)

        return attachments
    }

    public async publish() {
        if (this.publishLock) {
            throw new Error('Publish is already in progress');
        }

        this.publishLock = true;

       
        let oldEntryData, newEntryData;

        try {
            const dt = await this.guildHolder.getRepositoryManager().addOrUpdateEntry(this);
            oldEntryData = dt.oldEntryData;
            newEntryData = dt.newEntryData;
        } catch (error) {
            this.publishLock = false;
            throw error;
        }
        

        try {
            await this.guildHolder.logUpdate(oldEntryData, newEntryData);
        } catch (error) {
            this.publishLock = false;
            throw error;
        }

        this.getConfigManager().setConfig(SubmissionConfigs.POST, newEntryData.post);
        this.getConfigManager().setConfig(SubmissionConfigs.STATUS, SubmissionStatus.ACCEPTED);
        await this.statusUpdated();        
        this.publishLock = false;
    }

    public getRevisionsManager(): RevisionManager {
        return this.revisions;
    }

    public getFolderPath(): string {
        return this.folderPath;
    }

    public getGuildHolder(): GuildHolder {
        return this.guildHolder;
    }
}