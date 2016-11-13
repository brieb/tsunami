import * as vs from "vscode";
import { TsunamiContext } from "@derander/tsunami";
import { TsunamiPlugin } from "../TsunamiPlugin";
import { FsMoveWatcher } from "./relative-module-watcher/FsMoveWatcher";
import { FsMoveHandler } from "./relative-module-watcher/FsMoveHandler";
import { Logger } from "./relative-module-watcher/Logger";
import { FsMoveEventType } from "./relative-module-watcher/FsMoveEvent";

export class TsunamiRelativeModuleWatcher implements TsunamiPlugin {
    constructor(private tsuContext: TsunamiContext) { }

    public bindToContext(extContext: vs.ExtensionContext): void {
        const outputChannel = vs.window.createOutputChannel("TsunamiRelativeModuleWatcher");
        const logger: Logger = new Logger((message) => outputChannel.appendLine(message));

        // TODO don't hard code glob
        const fsWatcher = vs.workspace.createFileSystemWatcher("**/src/**", false, true, false);
        fsWatcher.onDidCreate(() => this.tsuContext.getProject().invalidate());
        fsWatcher.onDidDelete(() => this.tsuContext.getProject().invalidate());

        let moveWatcher: FsMoveWatcher;
        const handler: FsMoveHandler = new FsMoveHandler(this.tsuContext, logger);

        extContext.subscriptions.push({
            dispose: () => {
                logger.log("dispose");
                outputChannel.dispose();
                if (moveWatcher) {
                    moveWatcher.dispose();
                }
                fsWatcher.dispose();
            }
        });

        moveWatcher = new FsMoveWatcher({
            onDidMove: async (event) => {
                try {
                    logger.log(`### started move ${event.from.fsPath} ${event.to.fsPath} ${FsMoveEventType[event.type]}`);
                    const timerLabel = `time taken ${event.from.fsPath} ${event.to.fsPath} ${Date.now()}`;
                    logger.time(timerLabel);
                    await handler.handleMove(event);
                    logger.timeEnd(timerLabel);
                    logger.log(`### finished move ${event.from.fsPath} ${event.to.fsPath} ${FsMoveEventType[event.type]}\n`);
                } catch (err) {
                    logger.error(err);
                }
            }
        }, logger);
        logger.log("watching files");
    }
}
