import { Modal } from "../../interface/Modal.js";
import { AddAuthorModal } from "./AddAuthorModal.js";
import { EditRevisionModal } from "./EditRevisionModal.js";
import { SetScriptModal } from "./SetScriptModal.js";
import { SetTemplateModal } from "./SetTemplateModal.js";
import { DictionaryEditModal } from "./DictionaryEditModal.js";
import { AddAttachmentModal } from "./AddAttachmentModal.js";
import { AddImageModal } from "./AddImageModal.js";
import { FactEditModal } from "./FactEditModal.js";
import { SetDescriptionModal } from "./SetDescriptionModal.js";
import { GlobalTagModal } from "./GlobalTagModal.js";

export function getModals(): Modal[] {
    const Modals: Modal[] = [
        new EditRevisionModal(),
        new AddAuthorModal(),
        new SetTemplateModal(),
        new SetScriptModal(),
        new AddAttachmentModal(),
        new AddImageModal(),
        new DictionaryEditModal(),
        new FactEditModal(),
        new SetDescriptionModal(),
        new GlobalTagModal(),
    ];
    return Modals;
}
