import fs from 'fs/promises';
import path from 'path';

/**
 * Config type defines the structure for the configuration settings.
 */
export class Config<T> {
    id: string; // Unique identifier for the config
    default: T; // Default value for the config
    constructor(id: string, defaultValue: T) {
        this.id = id;
        this.default = defaultValue;
    }
}

/**
 * ConfigManager is a class that manages the configuration settings for various classes.
 */
export class ConfigManager {
    private changeListener?: () => void;

    /** The configuration map */
    private configMap = new Map<string, unknown>();

    /** The configuration file path */
    private readonly configFilePath: string;

    /** Whether the configuration has changed */
    private configChanged = false;

    constructor(filePath: string) {
        this.configFilePath = filePath;
    }

    public setChangeListener(listener: () => void): void {
        this.changeListener = listener;
    }
    
    /**
     * Loads the configuration from the file.
     */
    public async loadConfig(): Promise<this> {
        try {
            const data = await fs.readFile(this.configFilePath, 'utf-8');
            const parsed: Record<string, unknown> = JSON.parse(data);
            this.configMap = new Map(Object.entries(parsed));
        } catch {
            // Swallow errors (file might not exist / invalid JSON) and start with defaults.
        }
        return this;
    }

    /**
     * Saves the current configuration to the file.
     */
    public async saveConfig(): Promise<void> {
        if (!this.configChanged) return; // No changes to save

        const dir = path.dirname(this.configFilePath);
        try {
            // Ensure directory exists
            await fs.mkdir(dir, { recursive: true });
            const obj = Object.fromEntries(this.configMap);
            await fs.writeFile(this.configFilePath, JSON.stringify(obj, null, 2), 'utf-8');
            this.configChanged = false;
            if (this.changeListener) {
                this.changeListener();
            }
        } catch (err) {
            console.error(`Failed to save config to ${this.configFilePath}:`, err);
        }
    }

    /**
     * Retrieves a configuration value ensuring the return type matches the Config<T> provided.
     */
    public getConfig<T>(config: Config<T>): T {
        if (this.configMap.has(config.id)) {
            return this.configMap.get(config.id) as T;
        }
        return JSON.parse(JSON.stringify(config.default)) as T; // Return a deep copy of the default value
    }

    public isConfigSet<T>(config: Config<T>): boolean {
        return this.configMap.has(config.id);
    }

    public deleteConfig<T>(config: Config<T>): void {
        if (this.configMap.has(config.id)) {
            this.configChanged = true;
            this.configMap.delete(config.id);
        }
    }

    /**
     * Sets a configuration value ensuring type safety with Config<T>.
     */
    public setConfig<T>(config: Config<T>, value: T): void {
        if (this.configMap.get(config.id) !== value || typeof value === 'object') {
            this.configChanged = true;
        }
        this.configMap.set(config.id, value);
    }
}