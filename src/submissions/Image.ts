import { Snowflake } from "discord.js"

export type Image = {
    id: Snowflake,
    name: string,
    url: string,
    description: string,
    contentType: string,
}