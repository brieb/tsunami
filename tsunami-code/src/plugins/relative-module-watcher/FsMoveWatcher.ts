import * as vs from "vscode";
import { FsEventBatcher } from "./FsEventBatcher";
import { FsEvent, FsEventType } from "./FsEvent";
import { FsMoveEvent } from "./FsMoveEvent";
import { extractFsMoveEvent } from "./extractFsMoveEvent";
import { Logger } from "./Logger";

export interface FsMoveListener {
    onDidMove(event: FsMoveEvent): void;
}

export class FsMoveWatcher {
    private fsWatcher: vs.FileSystemWatcher;
    private eventDisposables: vs.Disposable[];
    private eventBatcher: FsEventBatcher;

    constructor(
        private listener: FsMoveListener,
        private logger: Logger,
    ) {
        this.eventBatcher = new FsEventBatcher((events) => this.onDidReceiveEvents(events));
        // TODO configurable glob
        this.fsWatcher = vs.workspace.createFileSystemWatcher("**/src/**", false, true, false);
        this.eventDisposables = [
            this.fsWatcher.onDidDelete(this.onDidDelete, this),
            this.fsWatcher.onDidCreate(this.onDidCreate, this),
        ];
    }

    public dispose() {
        this.fsWatcher.dispose();
        this.eventDisposables.forEach(disposable => disposable.dispose());
    }

    private onDidCreate(uri: vs.Uri) {
        this.eventBatcher.add({ type: FsEventType.CREATE, uri });
    }

    private onDidDelete(uri: vs.Uri) {
        this.eventBatcher.add({ type: FsEventType.DELETE, uri });
    }

    private onDidReceiveEvents(events: FsEvent[]) {
        const moveEvent = extractFsMoveEvent(events, this.logger);
        if (moveEvent) {
            this.listener.onDidMove(moveEvent);
        }
    }
}
