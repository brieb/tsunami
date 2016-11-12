import * as vs from "vscode";
import * as path from "path";
import * as ts from "typescript";
import { CodeEditGroup, TsunamiContext } from "@derander/tsunami";
import { FsMoveEvent, FsMoveEventType } from "./FsMoveEvent";
import { filenameToModuleSpecifier } from "./filenameToModuleSpecifier";
import { MovedModuleSpecifier, rewriteImports } from "./rewriteImports";

export class FsMoveHandler {
    constructor(private context: TsunamiContext) { }

    public async handleMove(event: FsMoveEvent) {
        console.log("handleMove", event.from.fsPath, event.to.fsPath, FsMoveEventType[event.type]);

        const fileNames = await this.context.getProject().getFileNames();
        const projSourceFiles = await Promise.all(fileNames.map(file => this.context.getSourceFileFor(file)));

        if (event.type === FsMoveEventType.FILE) {
            await this.handleFileMoves([event], projSourceFiles);
        } else if (event.type === FsMoveEventType.FOLDER) {
            await this.handleFolderMove(event, projSourceFiles);
        }
    }

    private async handleFileMoves(events: FsMoveEvent[], projSourceFiles: ts.SourceFile[]) {
        const movedModuleSpecifiers: MovedModuleSpecifier[] = events.map(event => ({
            from: filenameToModuleSpecifier(event.from.fsPath),
            to: filenameToModuleSpecifier(event.to.fsPath),
        }));

        const editGroups: CodeEditGroup[] = rewriteImports(projSourceFiles, movedModuleSpecifiers);
        await this.applyEdits(editGroups);

        return Promise.all(events.map(async (event) => {
            this.context.fileIndexerMap.delete(event.from.fsPath);
            await this.context.reloadFile(event.to.fsPath);
            return;
        }));
    }

    private async handleFolderMove(event: FsMoveEvent, projSourceFiles: ts.SourceFile[]) {
        const fromFolderPath = event.from.fsPath;
        const toFolderPath = event.to.fsPath;

        const movedFileNames = projSourceFiles
            .map(sourceFile => sourceFile.fileName)
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

        return this.handleFileMoves(fileMoveEvents, projSourceFiles);
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
