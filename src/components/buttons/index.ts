import { AddAuthorButton } from "./AddAuthorButton";
import { EditSubmissionButton } from "./EditSubmissionButton";
import { MakeRevisionCurrentButton } from "./MakeRevisionCurrentButton";
import { PublishButton } from "./PublishButton";
import { SetArchiveChannelButton } from "./SetArchiveChannelButton";
import { SetAttachmentsButton } from "./SetAttachmentsButton";
import { SetAuthorsButton } from "./SetAuthorsButton";
import { SetTagsButton } from "./SetTagsButton";

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