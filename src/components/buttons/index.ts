import { EditOthersYesNo } from "./EditOthersYesNo";
import { EditSubmissionButton } from "./EditSubmissionButton";
import { MakeRevisionCurrentButton } from "./MakeRevisionCurrentButton";
import { SetArchiveChannelButton } from "./SetArchiveChannelButton";
import { SetAttachmentsButton } from "./SetAttachmentsButton";
import { SetImagesButton } from "./SetImagesButton";
import { SetTagsButton } from "./SetTagsButton";

export function getButtons() {
    const Buttons = [
        new SetArchiveChannelButton(),
        new SetTagsButton(),
        new SetImagesButton(),
        new SetAttachmentsButton(),
        new EditSubmissionButton(),
        new EditOthersYesNo(),
        new MakeRevisionCurrentButton()
    ];
    return Buttons;
}