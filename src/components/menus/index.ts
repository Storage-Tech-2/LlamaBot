import { SetArchiveCategoriesMenu } from "./SetArchiveCategoriesMenu";
import { SetArchiveCategoryMenu } from "./SetArchiveCategoryMenu";
import { SetArchiveChannelMenu } from "./SetArchiveChannelMenu";
import { SetAttachmentsMenu } from "./SetAttachmentsMenu";
import { SetImagesMenu } from "./SetImagesMenu";
import { SetTagsMenu } from "./SetTagsMenu";

export function getMenus() {
    const Menus = [
        new SetArchiveCategoriesMenu(),
        new SetArchiveCategoryMenu(),
        new SetArchiveChannelMenu(),
        new SetTagsMenu(),
        new SetImagesMenu(),
        new SetAttachmentsMenu(),
    ];
    return Menus;
}