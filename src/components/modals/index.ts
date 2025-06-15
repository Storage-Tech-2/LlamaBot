import { Modal } from "../../interface/Modal";
import { EditRevisionModalPart1 } from "./EditRevisionModalPart1";
import { EditRevisionModalPart2 } from "./EditRevisionModalPart2";

export function getModals(): Modal[] {
    const Modals: Modal[] = [
        new EditRevisionModalPart1(),
        new EditRevisionModalPart2()
    ];
    return Modals;
}