import { Modal } from "../../interface/Modal.js";
import { EditRevisionModal } from "./EditRevisionModal.js";
import { SetScriptModal } from "./SetScriptModal.js";
import { SetTemplateModal } from "./SetTemplateModal.js";
import { DictionaryEditModal } from "./DictionaryEditModal.js";
import { AddAttachmentModal } from "./AddAttachmentModal.js";
import { AddImageModal } from "./AddImageModal.js";
import { FactEditModal } from "./FactEditModal.js";
import { AttachmentInfoModal } from "./AttachmentInfoModal.js";
import { GlobalTagModal } from "./GlobalTagModal.js";
import { PublishAddSummaryModal } from "./PublishAddSummaryModal.js";
import { AuthorModal } from "./AuthorModal.js";
export function getModals(): Modal[] {
    const Modals: Modal[] = [
        new EditRevisionModal(),
        new AuthorModal(),
        new SetTemplateModal(),
        new SetScriptModal(),
        new AddAttachmentModal(),
        new AddImageModal(),
        new DictionaryEditModal(),
        new FactEditModal(),
        new AttachmentInfoModal(),
        new GlobalTagModal(),
        new PublishAddSummaryModal(),
    ];
    return Modals;
}
