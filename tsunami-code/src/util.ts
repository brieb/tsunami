import * as path from "path";
import * as vscode from "vscode";
import * as tsu from "@derander/tsunami";

export function toTextEdit(edit: tsu.CodeEdit): vscode.TextEdit {
    return new vscode.TextEdit(new vscode.Range(
        edit.start.line - 1,
        edit.start.offset - 1,
        edit.end.line - 1,
        edit.end.offset - 1
    ), edit.newText);
}

export function toPrettyModuleSpecifier(localFileName: string, moduleSpecifier: string) {
    if (path.isAbsolute(moduleSpecifier)) {
        return path.relative(localFileName, moduleSpecifier);
    } else {
        return moduleSpecifier;
    }
}

export function applyCodeEdit(editBuilder: vscode.TextEditorEdit, edit: tsu.CodeEdit): void {
    editBuilder.replace(new vscode.Range(
        edit.start.line - 1,
        edit.start.offset - 1,
        edit.end.line - 1,
        edit.end.offset - 1
    ), edit.newText);
}
