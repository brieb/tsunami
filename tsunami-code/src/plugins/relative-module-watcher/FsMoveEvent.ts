import * as vs from "vscode";

export enum FsMoveEventType { FILE, FOLDER }

export interface FsMoveEvent {
    type: FsMoveEventType;
    from: vs.Uri;
    to: vs.Uri;
}
