import { Modal } from "../../interface/Modal";
import { AddAuthorModal } from "./AddAuthorModal";
import { EditRevisionModal } from "./EditRevisionModal";

export function getModals(): Modal[] {
    const Modals: Modal[] = [
        new EditRevisionModal(),
        new AddAuthorModal()
    ];
    return Modals;
}