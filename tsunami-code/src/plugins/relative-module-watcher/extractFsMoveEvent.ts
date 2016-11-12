import { sortBy } from "lodash";
import * as fs from "fs";
import * as path from "path";
import { FsEvent, FsEventType } from "./FsEvent";
import { FsMoveEvent, FsMoveEventType } from "./FsMoveEvent";

// Try to match up creation and deletion pairs as moves
export function extractFsMoveEvent(events: FsEvent[]): FsMoveEvent | void {
    events = sortBy(events, event => event.uri.fsPath);

    const createdFolders: { [folder: string]: boolean } = {};

    const folderCreationEvents: FsEvent[] = events
        .filter(event => {
            try {
                if (event.type === FsEventType.CREATE &&
                    fs.lstatSync(event.uri.fsPath).isDirectory() &&
                    !createdFolders[path.resolve(event.uri.fsPath, "..")]) {
                    createdFolders[event.uri.fsPath] = true;
                    return true;
                }
                return false;
            } catch (err) {
                return false;
            }
        });

    const folderCreationPaths: string[] = folderCreationEvents.map(e => e.uri.fsPath);

    const fileCreationEvents: FsEvent[] = events
        .filter(event => {
            try {
                return event.type === FsEventType.CREATE &&
                    fs.lstatSync(event.uri.fsPath).isFile();
            } catch (err) {
                return false;
            }
        })
        .filter(event => {
            // Swallow file creation events into parent folder creation
            return !isContainedInSomeFolder(event.uri.fsPath, folderCreationPaths);
        });

    const deletionEvents: FsEvent[] = events.filter(event => {
        return event.type === FsEventType.DELETE;
    });

    if (folderCreationEvents.length > 0 && fileCreationEvents.length > 0) {
        console.warn("cannot handle simultaneous file and folder move");
        return;
    }

    const creationEvents = folderCreationEvents.length > 0 ? folderCreationEvents : fileCreationEvents;
    if (creationEvents.length !== deletionEvents.length) {
        return;
    }

    if (creationEvents.length !== 1) {
        console.warn("cannot handle moving more than one file or folder at a time");
        return;
    }

    const deletionEvent: FsEvent = deletionEvents[0];
    const creationEvent: FsEvent = creationEvents[0];
    const moveType: FsMoveEventType = folderCreationPaths.length === 1 ? FsMoveEventType.FOLDER : FsMoveEventType.FILE;

    return {
        from: deletionEvent.uri,
        to: creationEvent.uri,
        type: moveType
    };
}

function isContainedInSomeFolder(filePath: string, folderPaths: string[]): boolean {
    for (let folderPath of folderPaths) {
        if (filePath.indexOf(folderPath) === 0) {
            return true;
        }
    }
    return false;
}
