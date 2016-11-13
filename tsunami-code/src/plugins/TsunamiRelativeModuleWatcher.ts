import * as vs from "vscode";
import { TsunamiContext } from "@derander/tsunami";
import { TsunamiPlugin } from "../TsunamiPlugin";
import { FsMoveWatcher } from "./relative-module-watcher/FsMoveWatcher";
import { FsMoveHandler } from "./relative-module-watcher/FsMoveHandler";
import { Logger } from "./relative-module-watcher/Logger";
import { FsMoveEventType } from "./relative-module-watcher/FsMoveEvent";

export class TsunamiRelativeModuleWatcher implements TsunamiPlugin {
    constructor(private context: TsunamiContext) { }

    public bindToContext(context: vs.ExtensionContext): void {
        const outputChannel = vs.window.createOutputChannel("TsunamiRelativeModuleWatcher");
        const logger: Logger = new Logger((message) => outputChannel.appendLine(message));

        let watcher: FsMoveWatcher;
        const handler: FsMoveHandler = new FsMoveHandler(this.context, logger);

        context.subscriptions.push({
            dispose: () => {
                logger.log("dispose");
                outputChannel.dispose();
                if (watcher) {
                    watcher.dispose();
                }
            }
        });

        watcher = new FsMoveWatcher({
            onDidMove: async (event) => {
                try {
                    logger.log(`### started move ${event.from.fsPath} ${event.to.fsPath} ${FsMoveEventType[event.type]}`);
                    logger.time(`time taken ${event.from.fsPath} ${event.to.fsPath}`);
                    await handler.handleMove(event);
                    logger.timeEnd(`time taken ${event.from.fsPath} ${event.to.fsPath}`);
                    logger.log(`### finished move ${event.from.fsPath} ${event.to.fsPath} ${FsMoveEventType[event.type]}\n`);
                } catch (err) {
                    logger.error(err);
                }
            }
        });
        logger.log("watching files");
    }
}
