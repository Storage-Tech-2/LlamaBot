import { EditorPowersCommand } from "./EditorPowersCommand.js";
import { EndorseCommand } from "./EndorseCommand.js";
import { Mwa } from "./MwaCommand.js";
export function getCommands() {
    const Commands = [
        new Mwa(),
        new EndorseCommand(),
        new EditorPowersCommand()
    ];
    return Commands;
}