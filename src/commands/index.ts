import { EndorseCommand } from "./endorse";
import { Mwa } from "./mwa";
export function getCommands() {
    const Commands = [
        new Mwa(),
        new EndorseCommand()
    ];
    return Commands;
}