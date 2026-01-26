import { SetArchiveCategoriesMenu } from "./SetArchiveCategoriesMenu.js";
import { SetArchiveCategoryMenu } from "./SetArchiveCategoryMenu.js";
import { SetArchiveChannelMenu } from "./SetArchiveChannelMenu.js";
import { SetAttachmentsMenu } from "./SetAttachmentsMenu.js";
import { SetAuthorsMenu } from "./SetAuthorsMenu.js";
import { SetDesignerRoleMenu } from "./SetDesignerRoleMenu.js";
import { SetEditorRolesMenu } from "./SetEditorRolesMenu.js";
import { SetEndorseRolesMenu } from "./SetEndorseRolesMenu.js";
import { SetHelperRoleMenu } from "./SetHelperRoleMenu.js";
import { SetImagesMenu } from "./SetImagesMenu.js";
import { SetTagsMenu } from "./SetTagsMenu.js";
import { GlobalTagSelectMenu } from "./GlobalTagSelectMenu.js";

export function getMenus() {
    const Menus = [
        new SetArchiveCategoriesMenu(),
        new SetEndorseRolesMenu(),
        new SetEditorRolesMenu(),
        new SetHelperRoleMenu(),
        new SetDesignerRoleMenu(),

        new SetAuthorsMenu(),
        new SetArchiveCategoryMenu(),
        new SetArchiveChannelMenu(),
        new SetTagsMenu(),
        new SetImagesMenu(),
        new SetAttachmentsMenu(),
        new GlobalTagSelectMenu()
    ];
    return Menus;
}
