import { Modal } from "../../interface/Modal.js";
import { AddAuthorModal } from "./AddAuthorModal.js";
import { EditRevisionModal } from "./EditRevisionModal.js";
import { SetScriptModal } from "./SetScriptModal.js";
import { SetTemplateModal } from "./SetTemplateModal.js";

export function getModals(): Modal[] {
    const Modals: Modal[] = [
        new EditRevisionModal(),
        new AddAuthorModal(),
        new SetTemplateModal(),
        new SetScriptModal()
    ];
    return Modals;
}