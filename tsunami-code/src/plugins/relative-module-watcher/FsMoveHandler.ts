import * as path from "path";
import * as vs from "vscode";
import { CodeEditGroup, TsunamiContext, applyCodeEdits } from "@derander/tsunami";
import { FsMoveEvent, FsMoveEventType } from "./FsMoveEvent";
import { filenameToModuleSpecifier } from "./filenameToModuleSpecifier";
import { MovedModuleSpecifier, rewriteImports } from "./rewriteImports";
import { Logger } from "./Logger";

export class FsMoveHandler {
    private isPending: boolean;
    private eventQueue: {
        event: FsMoveEvent;
        resolve: Function;
    }[] = [];

    constructor(
        private context: TsunamiContext,
        private logger: Logger,
    ) { }

    public async handleMove(event: FsMoveEvent) {
        vs.window.setStatusBarMessage(`$(squirrel) moved ${event.to.fsPath} - on it`, 2000);
        const promise = new Promise((resolve) => {
            this.eventQueue.push({ event, resolve });
        });
        this.flush();
        return promise;
    }

    private async flush() {
        if (this.isPending) {
            this.logger.log("pending move");
            return;
        }

        const item = this.eventQueue.shift();
        if (!item) {
            this.logger.log("no more move events");
            return;
        }

        this.isPending = true;

        const { event, resolve } = item;
        const logLabel = `handling ${event.from.fsPath} ${event.to.fsPath} ${FsMoveEventType[event.type]} ${Date.now()}`;
        this.logger.time(logLabel);
        await this.handleMoveInternal(event);
        this.logger.timeEnd(logLabel);
        resolve();

        this.isPending = false;

        this.flush();
    }

    private async handleMoveInternal(event: FsMoveEvent) {
        await vs.workspace.saveAll(false);
        const projFileNames = await this.context.getProject().getFileNames();

        if (event.type === FsMoveEventType.FILE) {
            await this.handleFileMoves([event], projFileNames);
        } else if (event.type === FsMoveEventType.FOLDER) {
            await this.handleFolderMove(event, projFileNames);
        }
    }

    private async handleFileMoves(events: FsMoveEvent[], projFileNames: string[]) {
        const movedModuleSpecifiers: MovedModuleSpecifier[] = events.map(event => ({
            from: filenameToModuleSpecifier(event.from.fsPath),
            to: filenameToModuleSpecifier(event.to.fsPath),
        }));

        this.logger.time("rewrite imports");
        const editGroups: CodeEditGroup[] = await rewriteImports(projFileNames, movedModuleSpecifiers, this.logger);
        this.logger.timeEnd("rewrite imports");

        this.logger.time("apply edits");
        await this.applyEdits(editGroups);
        this.logger.timeEnd("apply edits");

        vs.window.setStatusBarMessage(`$(thumbsup) rewrote rel imports. reindexing...`, 2000);

        this.logger.time("reindex");
        await Promise.all(events.map(async (event) => {
            this.context.fileIndexerMap.delete(event.from.fsPath);
            await this.context.reloadFile(event.to.fsPath);
        }));
        // await vs.commands.executeCommand("tsunami.reindexProject");
        this.logger.timeEnd("reindex");
    }

    private async handleFolderMove(event: FsMoveEvent, projFileNames: string[]) {
        const fromFolderPath = event.from.fsPath;
        const toFolderPath = event.to.fsPath;

        const movedFileNames = projFileNames
            .filter(fileName => fileName.startsWith(event.to.fsPath + path.sep));

        const fileMoveEvents: FsMoveEvent[] = movedFileNames.map(toFileName => {
            const basename = path.basename(toFileName);
            const relPath = path.relative(toFolderPath, path.dirname(toFileName));
            const fromFileName = path.resolve(fromFolderPath, relPath, basename);
            return {
                type: FsMoveEventType.FILE,
                from: vs.Uri.file(fromFileName),
                to: vs.Uri.file(toFileName),
            };
        });

        return this.handleFileMoves(fileMoveEvents, projFileNames);
    }

    private async applyEdits(editGroups: CodeEditGroup[]) {
        // const workspaceEdit = new vs.WorkspaceEdit();
        // for (let editGroup of editGroups) {
        //     const uri = vs.Uri.file(editGroup.file);
        //     workspaceEdit.set(uri, editGroup.edits.map(edit => new vs.TextEdit(new vs.Range(
        //         edit.start.line - 1,
        //         edit.start.offset - 1,
        //         edit.end.line - 1,
        //         edit.end.offset - 1
        //     ), edit.newText)));
        // }

        // const textDocuments = await Promise.all(editGroups.map(e => vs.workspace.openTextDocument(e.file)));
        // await vs.workspace.applyEdit(workspaceEdit);
        // await Promise.all(textDocuments.map(textDocument => textDocument.save()));

        // await vs.workspace.applyEdit(workspaceEdit);
        // await vs.workspace.saveAll(false);

        return Promise.all(editGroups.map(async (editGroup) => {
            await applyCodeEdits(editGroup.file, editGroup.edits);
        }));
    }
}
