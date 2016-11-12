import * as vs from "vscode";

export enum FsEventType { CREATE, DELETE }

export interface FsEvent {
    type: FsEventType;
    uri: vs.Uri;
}
