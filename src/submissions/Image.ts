import { Snowflake } from "discord.js"

export type Image = {
    id: Snowflake,
    name: string,
    url: string,
    description: string,
    contentType: string,
    width?: number,
    height?: number,
    path?: string, // Local path if downloaded
}