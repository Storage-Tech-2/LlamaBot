import { Config } from "../config/ConfigManager.js";

export const RevisionConfigs = {
    /**
     * Submission name
     */
    NAME: new Config("name", ""),

    /**
     * Submission authors
     */
    AUTHORS: new Config("authors", []),

    /**
     * Submission description
     */
    DESCRIPTION: new Config("description", ""),

    /**
     * Submission features
     */
    FEATURES: new Config("features", []),

    /**
     * Submission cons
     */
    CONS: new Config("cons", []),

    /**
     * Submission notes
     */
    NOTES: new Config("notes", ""),
}