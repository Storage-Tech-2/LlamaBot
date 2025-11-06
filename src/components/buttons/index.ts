import { AddAuthorButton } from "./AddAuthorButton.js";
import { ConfirmAuthorsButton } from "./ConfirmAuthorsButton.js";
import { EditSubmissionButton } from "./EditSubmissionButton.js";
import { FixErrorsButton } from "./FixErrorsButton.js";
import { MakeRevisionCurrentButton } from "./MakeRevisionCurrentButton.js";
import { MoveConvoCancelButton } from "./MoveConvoCancelButton.js";
import { MoveConvoConfirmButton } from "./MoveConvoConfirmButton.js";
import { NotABotButton } from "./NotABotButton.js";
import { PublishButton } from "./PublishButton.js";
import { SetArchiveChannelButton } from "./SetArchiveChannelButton.js";
import { SetAttachmentsButton } from "./SetAttachmentsButton.js";
import { SetAuthorsButton } from "./SetAuthorsButton.js";
import { SetTagsButton } from "./SetTagsButton.js";
import { SkipAttachmentsButton } from "./SkipAttachmentsButton.js";
import { SkipImagesButton } from "./SkipImagesButton.js";

export function getButtons() {
    const Buttons = [
        new SetArchiveChannelButton(),
        new SetAuthorsButton(),
        new SetTagsButton(),
        new SetAttachmentsButton(),
        new EditSubmissionButton(),
        new MakeRevisionCurrentButton(),
        new AddAuthorButton(),
        new PublishButton(),
        new SkipImagesButton(),
        new SkipAttachmentsButton(),
        new ConfirmAuthorsButton(),
        new FixErrorsButton(),
        new MoveConvoConfirmButton(),
        new MoveConvoCancelButton(),
        new NotABotButton()
    ];
    return Buttons;
}