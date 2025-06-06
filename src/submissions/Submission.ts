import { Message, MessageReferenceType, Snowflake } from "discord.js";
import { GuildHolder } from "../GuildHolder";
import { ConfigManager } from "../config/ConfigManager";
import Path from "path";

export class Submission {
    private guildHolder: GuildHolder;
    private id: Snowflake;
    private folderPath: string;
    private config: ConfigManager;
    public lastAccessed: number = Date.now();

    constructor(
        guildHolder: GuildHolder,
        id: Snowflake,
        folderPath: string,
    ) {
        this.guildHolder = guildHolder;
        this.id = id;
        this.folderPath = folderPath;
        this.config = new ConfigManager(Path.join(folderPath, 'submission.json'));
    }

    /**
     * Called when the submission is created from nothing
     */
    public async init() {

        


    }

    public async handleMessage(message: Message) {
        if (message.reference && message.reference.type === MessageReferenceType.Default) {
            // its a reply
            
        }
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
        return true;
    }

    public getId(): Snowflake {
        return this.id;
    }

}