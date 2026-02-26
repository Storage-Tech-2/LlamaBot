import fs from 'fs/promises';
import { AttachmentsState, UserData } from './UserData.js';
import { Snowflake } from 'discord.js';
import { safeJoinPath, safeWorkspacePath } from '../utils/SafePath.js';

export class UserManager {
    private folderPath: string;

    constructor(folderPath: string) {
        this.folderPath = safeWorkspacePath(folderPath);
        fs.mkdir(this.folderPath, { recursive: true })
            .catch(error => {
                console.error(`Failed to create user data folder at ${this.folderPath}:`, error);
            });
    }

    public async getUserData(userId: string): Promise<UserData | null> {
        const userPath = safeJoinPath(this.folderPath, `${userId}.json`);
        try {
            const data = JSON.parse(await fs.readFile(userPath, 'utf-8')) as UserData;
            if (!data.attachmentsAllowedState) {
                data.attachmentsAllowedState = AttachmentsState.ALLOWED;
            }
            return data;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return null; // User data not found
            }
            throw error; // Other errors
        }
    }

    public async getOrCreateUserData(userId: string, username: string): Promise<UserData> {
        let userData = await this.getUserData(userId);
        if (!userData) {
            userData = {
                id: userId as Snowflake,
                username,
                thankedCountTotal: 0,
                thankedBuffer: [],
                disableRole: false,
                lastThanked: 0,
                archivedPosts: [],
                attachmentsAllowedState: AttachmentsState.DISALLOWED,
                attachmentsAllowedExpiry: 0,
                messagesToDeleteOnTimeout: [],
                llmWarnings: [],
            }
        }
        return userData;
    }

    public async getAllUserIDs(): Promise<Snowflake[]> {
        const files = await fs.readdir(this.folderPath);
        const userIds: Snowflake[] = [];
        for (const file of files) {
            if (file.endsWith('.json')) {
                const userId = file.slice(0, -5); // Remove '.json' extension
                userIds.push(userId as Snowflake);
            }
        }
        return userIds;
    }

    public async saveUserData(userData: UserData): Promise<void> {
        const userPath = safeJoinPath(this.folderPath, `${userData.id}.json`);
        await fs.writeFile(userPath, JSON.stringify(userData, null, 2), 'utf-8');
    }

}
