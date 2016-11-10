import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import * as vs from "vscode";
import {
    CodeEdit,
    CodeEditGroup,
    ImportBlockBuilder,
    ImportEditor,
    ImportStatementType,
    ModuleSpecifier,
    SimpleImportBlockFormatter,
    TsunamiContext,
    getTypeOfModuleSpecifier
} from "@derander/tsunami";
import { TsunamiPlugin } from "../TsunamiPlugin";

export class TsunamiRelativeModuleWatcher implements TsunamiPlugin {
    constructor(private context: TsunamiContext) { }

    public bindToContext(context: vs.ExtensionContext): void {
        let watcher: FsMoveWatcher;
        const handler: FsMoveHandler = new FsMoveHandler(this.context);

        context.subscriptions.push({
            dispose: () => {
                if (watcher) {
                    watcher.dispose();
                }
            }
        });

        watcher = new FsMoveWatcher({
            onDidMove: (event) => handler.handleMove(event)
        });
    }
}

class FsMoveHandler {
    constructor(private context: TsunamiContext) { }

    public async handleMove(event: FsMoveEvent) {
        console.log("handleMove", event.from.fsPath, event.to.fsPath, FsMoveEventType[event.type]);
        if (event.type === FsMoveEventType.FILE) {
            await this.handleFileMove(event);
        } else if (event.type === FsMoveEventType.FOLDER) {
            await this.handleFolderMove(event);
        }
    }

    private async handleFileMove(event: FsMoveEvent) {
        const fromModulePath = event.from.fsPath.replace(/\.tsx?/g, "") as ModuleSpecifier;
        const toModulePath = event.to.fsPath.replace(/\.tsx?/g, "") as ModuleSpecifier;

        const editGroups: CodeEditGroup[] = [];
        const editor = new ImportEditor(new SimpleImportBlockFormatter());

        const fileNames = await this.context.getProject().getFileNames();
        const sourceFilePromises = fileNames.map(file => this.context.getSourceFileFor(file));

        for (let sourceFilePromise of sourceFilePromises) {
            const sourceFile = await sourceFilePromise;
            const fileEdits = rewriteFileModuleImportInFile(sourceFile, editor, fromModulePath, toModulePath);
            if (fileEdits) {
                editGroups.push(fileEdits);
            }
        }

        const movedFileSource = await this.context.getSourceFileFor(event.to.fsPath);
        const movedFileEdits = rewriteImportsForMovedFile(movedFileSource, editor, fromModulePath, toModulePath);
        if (movedFileEdits) {
            editGroups.push({ file: event.to.fsPath, edits: movedFileEdits });
        }

        await this.applyEdits(editGroups);

        this.context.fileIndexerMap.delete(event.from.fsPath);
        await this.context.reloadFile(event.to.fsPath);
    }

    private async handleFolderMove(event: FsMoveEvent) {
        const fromFolderPath = event.from.fsPath;
        const toFolderPath = event.to.fsPath;

        const editGroups: CodeEditGroup[] = [];
        const editor = new ImportEditor(new SimpleImportBlockFormatter());

        const fileNames = await this.context.getProject().getFileNames();
        const sourceFilePromises = fileNames
            .filter(fileName => !fileName.startsWith(event.to.fsPath))
            .map(file => this.context.getSourceFileFor(file));

        const movedFilenames = fileNames.filter(fileName => fileName.startsWith(event.to.fsPath));

        for (let sourceFilePromise of sourceFilePromises) {
            const sourceFile = await sourceFilePromise;
            const fileEdits = rewriteFolderModuleImportInFile(sourceFile, editor, fromFolderPath, toFolderPath);
            if (fileEdits) {
                editGroups.push(fileEdits);
            }
        }

        for (let movedFilename of movedFilenames) {
            const movedFileSource = await this.context.getSourceFileFor(movedFilename);

            const relToFolder = path.relative(path.dirname(movedFilename), event.to.fsPath);
            const fromFilePath = path.resolve(event.from.fsPath, relToFolder, path.basename(movedFilename)) as ModuleSpecifier;
            const toFilePath = movedFilename as ModuleSpecifier;
            const fromModulePath = fromFilePath.replace(/\.tsx?/g, "") as ModuleSpecifier;
            const toModulePath = toFilePath.replace(/\.tsx?/g, "") as ModuleSpecifier;
            const movedFileEdits = rewriteImportsForMovedFile(movedFileSource, editor, fromModulePath, toModulePath);
            if (movedFileEdits) {
                editGroups.push({ file: movedFilename, edits: movedFileEdits });
            }
        }

        await this.applyEdits(editGroups);

        const indexedFilenames = this.context.fileIndexerMap.keys();
        for (let indexedFilename of indexedFilenames) {
            if (indexedFilename.startsWith(event.from.fsPath)) {
                this.context.fileIndexerMap.delete(indexedFilename);
            }
        }
        for (let projFilename of fileNames) {
            if (projFilename.startsWith(event.from.fsPath)) {
                this.context.reloadFile(projFilename);
            }
        }
    }

    private async applyEdits(editGroups: CodeEditGroup[]) {
        const workspaceEdit = new vs.WorkspaceEdit();
        for (let editGroup of editGroups) {
            const uri = vs.Uri.file(editGroup.file);
            workspaceEdit.set(uri, editGroup.edits.map(edit => new vs.TextEdit(new vs.Range(
                edit.start.line - 1,
                edit.start.offset - 1,
                edit.end.line - 1,
                edit.end.offset - 1
            ), edit.newText)));
        }

        // const textDocuments = await Promise.all(editGroups.map(e => vs.workspace.openTextDocument(e.file)));
        // await vs.workspace.applyEdit(workspaceEdit);
        // await Promise.all(textDocuments.map(textDocument => textDocument.save()));

        await vs.workspace.applyEdit(workspaceEdit);
        await vs.workspace.saveAll(false);
    }
}

interface FsMoveListener {
    onDidMove(event: FsMoveEvent): void;
}

class FsMoveWatcher {
    private fsWatcher: vs.FileSystemWatcher;
    private eventDisposables: vs.Disposable[];
    private eventBatcher: FsEventBatcher;

    constructor(private listener: FsMoveListener) {
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
        const moveEvent = extractMoveEvent(events);
        if (moveEvent) {
            this.listener.onDidMove(moveEvent);
        }
    }
}

enum FsEventType { CREATE, DELETE }

interface FsEvent {
    type: FsEventType;
    uri: vs.Uri;
}

class FsEventBatcher {
    private events: FsEvent[] = [];

    constructor(
        private onDidReceiveEvents: (events: FsEvent[]) => void
    ) { }

    public add(event: FsEvent) {
        this.events.push(event);
        this.maybeEmit();
    }

    private maybeEmit = debounce(() => {
        this.onDidReceiveEvents(this.events);
        this.events = [];
    }, 100);
}

enum FsMoveEventType { FILE, FOLDER }

interface FsMoveEvent {
    type: FsMoveEventType;
    from: vs.Uri;
    to: vs.Uri;
}

// Try to match up creation and deletion pairs as moves
function extractMoveEvent(events: FsEvent[]): FsMoveEvent | void {
    events = (<FsEvent[]>[]).concat(events);
    events.sort((a, b) => a.uri.fsPath < b.uri.fsPath ? -1 : 1);

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

// Returns a function, that, as long as it continues to be invoked, will not
// be triggered. The function will be called after it stops being called for
// N milliseconds. If `immediate` is passed, trigger the function on the
// leading edge, instead of the trailing.
// https://davidwalsh.name/javascript-debounce-function
function debounce(func: Function, wait: number, immediate = false) {
    var timeout;
    return function () {
        var context = this, args = arguments;
        var later = function () {
            timeout = null;
            if (!immediate) {
                func.apply(context, args);
            }
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) {
            func.apply(context, args);
        }
    };
}

function rewriteFileModuleImportInFile(
    sourceFile: ts.SourceFile,
    editor: ImportEditor,
    fromModuleSpecifier: ModuleSpecifier,
    toModuleSpecifier: ModuleSpecifier
): CodeEditGroup | undefined {
    const currentBlock = ImportBlockBuilder.fromFile(sourceFile).build();
    const importRecords = currentBlock.importRecords;

    if (importRecords[fromModuleSpecifier]) {
        const newBlock = ImportBlockBuilder.from(currentBlock)
            .renameModule(fromModuleSpecifier, toModuleSpecifier)
            .build();

        const edits = editor.applyImportBlockToFile(sourceFile, newBlock);
        return { file: sourceFile.fileName, edits };
    } else {
        return undefined;
    }
}

function rewriteImportsForMovedFile(
    sourceFile: ts.SourceFile,
    editor: ImportEditor,
    fromModuleSpecifier: ModuleSpecifier,
    toModuleSpecifier: ModuleSpecifier
): CodeEdit[] | undefined {
    const currentBlock = ImportBlockBuilder.fromFile(sourceFile).build();
    const importRecords = currentBlock.importRecords;

    const renames = <{ from: ModuleSpecifier, to: ModuleSpecifier }[]>[];

    for (let canonicalModuleName in importRecords) {
        if (getTypeOfModuleSpecifier(canonicalModuleName) === ImportStatementType.PROJECT_RELATIVE) {
            const fromRelPath = getRelPathToModule(toModuleSpecifier, canonicalModuleName);
            const absPath = path.resolve(path.dirname(fromModuleSpecifier), fromRelPath);
            const toRelPath = getRelPathToModule(toModuleSpecifier, absPath);
            if (fromRelPath !== toRelPath) {
                const from = canonicalModuleName as ModuleSpecifier;
                const to = absPath as ModuleSpecifier;
                renames.push({ from, to });
            }
        }
    }

    if (renames.length === 0) {
        return undefined;
    }

    const newBlockBuilder = ImportBlockBuilder.from(currentBlock);
    renames.forEach(({from, to}) => {
        newBlockBuilder.renameModule(from, to);
    });
    const newBlock = newBlockBuilder.build();

    return editor.applyImportBlockToFile(sourceFile, newBlock);
}

function getRelPathToModule(referrerFilename, moduleFilename) {
    const moduleName = path.basename(moduleFilename, path.extname(moduleFilename));
    let relPath = path.relative(path.dirname(referrerFilename), path.dirname(moduleFilename));
    if (relPath === "") {
        relPath = ".";
    } else if (!relPath.startsWith(".")) {
        relPath = "./" + relPath;
    }
    relPath += "/" + moduleName;
    return relPath;
}

function rewriteFolderModuleImportInFile(
    sourceFile: ts.SourceFile,
    editor: ImportEditor,
    fromFolderPath: string,
    toFolderPath: string
): CodeEditGroup | undefined {
    const currentBlock = ImportBlockBuilder.fromFile(sourceFile).build();
    const importRecords = currentBlock.importRecords;

    const renames = <{ from: ModuleSpecifier, to: ModuleSpecifier }[]>[];
    for (let importModuleName in importRecords) {
        if (getTypeOfModuleSpecifier(importModuleName) === ImportStatementType.PROJECT_RELATIVE &&
            importModuleName.startsWith(fromFolderPath)) {
            const relToFromFolder = path.relative(path.dirname(importModuleName), fromFolderPath);
            const res = path.resolve(toFolderPath, relToFromFolder, path.basename(importModuleName));
            if (res !== importModuleName) {
                const from = importModuleName as ModuleSpecifier;
                const to = res as ModuleSpecifier;
                renames.push({ from, to });
            }
        }
    }

    if (renames.length === 0) {
        return undefined;
    }

    const newBlockBuilder = ImportBlockBuilder.from(currentBlock);
    renames.forEach(({from, to}) => {
        newBlockBuilder.renameModule(from, to);
    });
    const newBlock = newBlockBuilder.build();

    const edits = editor.applyImportBlockToFile(sourceFile, newBlock);
    return { file: sourceFile.fileName, edits };
}
