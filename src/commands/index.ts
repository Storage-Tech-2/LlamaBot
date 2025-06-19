import { EditorPowersCommand } from "./EditorPowersCommand";
import { EndorseCommand } from "./EndorseCommand";
import { Mwa } from "./MwaCommand";
export function getCommands() {
    const Commands = [
        new Mwa(),
        new EndorseCommand(),
        new EditorPowersCommand()
    ];
    return Commands;
}