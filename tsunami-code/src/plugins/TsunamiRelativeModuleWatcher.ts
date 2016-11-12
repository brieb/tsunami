import * as vs from "vscode";
import { TsunamiContext } from "@derander/tsunami";
import { TsunamiPlugin } from "../TsunamiPlugin";
import { FsMoveWatcher } from "./relative-module-watcher/FsMoveWatcher";
import { FsMoveHandler } from "./relative-module-watcher/FsMoveHandler";

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
