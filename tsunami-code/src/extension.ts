import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as tsu from "@derander/tsunami";
import { TsunamiExtension } from "./TsunamiExtension";
import { ImportSymbolCommand } from "./commands/ImportSymbolCommand";
import { ReindexProjectCommand } from "./commands/ReindexProjectCommand";
import { TsunamiCodeActionProvider } from "./plugins/TsunamiCodeActionProvider";
import { TsunamiCodeCompletionProvider } from "./plugins/TsunamiCodeCompletionProvider";
import { TsunamiRelativeModuleWatcher } from "./plugins/TsunamiRelativeModuleWatcher";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const projectRoot = vscode.workspace.rootPath;
    console.log("Activating!");

    /* Tsunami is only available in projects. */
    if (!projectRoot) {
        return;
    }

    const tsconfigPath = path.join(projectRoot, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) {
        console.log("Aborting tsunami initialization: couldn't find tsconfig at ", tsconfigPath);
        return;
    }

    const project = await tsu.TsProject.fromRootDir(projectRoot);
    const tsunami = new tsu.Tsunami(
        project,
        tsu.buildFormatOptions({
            indentSize: 2
        })
    );

    const extension = new TsunamiExtension(
        tsunami.getContext(),
        [
            new TsunamiCodeCompletionProvider(tsunami.getContext()),
            new TsunamiCodeActionProvider(),
            new TsunamiRelativeModuleWatcher(tsunami.getContext()),
        ],
        [
            new ReindexProjectCommand(tsunami)
        ],
        [
            new ImportSymbolCommand(tsunami.getContext())
        ]
    );

    extension.bindToContext(context);

    try {
        await tsunami.buildInitialProjectIndex();
        vscode.window.setStatusBarMessage("[tsunami] $(thumbsup) Done indexing: " + path.basename(projectRoot), 3000);
    } catch (err) {
        console.error(err);
    }
}

export function deactivate() {
    /* do nothing */
}
