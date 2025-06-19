import { AddAuthorButton } from "./AddAuthorButton.js";
import { EditSubmissionButton } from "./EditSubmissionButton.js";
import { MakeRevisionCurrentButton } from "./MakeRevisionCurrentButton.js";
import { PublishButton } from "./PublishButton.js";
import { SetArchiveChannelButton } from "./SetArchiveChannelButton.js";
import { SetAttachmentsButton } from "./SetAttachmentsButton.js";
import { SetAuthorsButton } from "./SetAuthorsButton.js";
import { SetTagsButton } from "./SetTagsButton.js";

export function getButtons() {
    const Buttons = [
        new SetArchiveChannelButton(),
        new SetAuthorsButton(),
        new SetTagsButton(),
        new SetAttachmentsButton(),
        new EditSubmissionButton(),
        new MakeRevisionCurrentButton(),
        new AddAuthorButton(),
        new PublishButton()
    ];
    return Buttons;
}