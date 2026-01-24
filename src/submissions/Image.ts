import { BaseAttachment } from "./Attachment.js"

export type Image = BaseAttachment & {
    width?: number,
    height?: number
}