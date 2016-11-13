import * as fs from "fs";
import * as path from "path";
import {
    CodeEditGroup,
    ImportBlockBuilder,
    ImportEditor,
    ImportStatementType,
    ModuleSpecifier,
    SimpleImportBlockFormatter,
} from "@derander/tsunami";
import { filenameToModuleSpecifier } from "./filenameToModuleSpecifier";
import { Logger } from "./Logger";
import { loadSourceFiles } from "./loadSourceFiles";

export interface MovedModuleSpecifier {
    from: ModuleSpecifier;
    to: ModuleSpecifier;
}

export async function rewriteImports(
    projFileNames: string[],
    movedModuleSpecifiers: MovedModuleSpecifier[],
    logger: Logger,
): Promise<CodeEditGroup[]> {
    const editGroups: CodeEditGroup[] = [];
    const editor = new ImportEditor(new SimpleImportBlockFormatter());

    const movedModuleFromTo: { [from: string]: ModuleSpecifier } = {};
    const movedModuleToFrom: { [to: string]: ModuleSpecifier } = {};
    for (let moved of movedModuleSpecifiers) {
        movedModuleFromTo[moved.from] = moved.to;
        movedModuleToFrom[moved.to] = moved.from;
    }

    logger.time("load source files");
    const projSourceFiles = await loadSourceFiles(projFileNames);
    logger.timeEnd("load source files");

    for (let sourceFile of projSourceFiles) {
        logger.log("started processing", sourceFile.fileName);

        let didUpdateImports: boolean = false;

        const moduleSpecifier: ModuleSpecifier = filenameToModuleSpecifier(sourceFile.fileName);
        const currentBlock = ImportBlockBuilder.fromFile(sourceFile).build();
        const newBlockBuilder = ImportBlockBuilder.from(currentBlock);

        const relativeImportRecords = Object.keys(currentBlock.importRecords)
            .map(k => currentBlock.importRecords[k])
            .filter(record => record.type === ImportStatementType.PROJECT_RELATIVE);

        const relativeImportRecordsToRewrite = relativeImportRecords
            .filter(record => movedModuleFromTo[record.moduleSpecifier] !== undefined);

        for (let record of relativeImportRecordsToRewrite) {
            const from = record.moduleSpecifier;
            const to = movedModuleFromTo[record.moduleSpecifier];
            newBlockBuilder.renameModule(from, to);
            didUpdateImports = true;
            logger.log("  renaming", from, to);
        }

        const wasSelfMoved = movedModuleToFrom[moduleSpecifier] !== undefined;
        if (wasSelfMoved) {
            const from = movedModuleToFrom[moduleSpecifier];
            const to = moduleSpecifier;
            const fromDir = path.dirname(from);
            const toDir = path.dirname(to);

            for (let record of relativeImportRecords) {
                const recordDir = path.dirname(record.moduleSpecifier);
                const recordBasename = path.basename(record.moduleSpecifier);
                const fromRelPath = path.relative(toDir, recordDir);
                const recordAbs = path.resolve(fromDir, fromRelPath, recordBasename) as ModuleSpecifier;
                if (fs.existsSync(recordAbs + ".ts") || fs.existsSync(recordAbs + ".tsx")) {
                    newBlockBuilder.renameModule(record.moduleSpecifier, recordAbs);
                    didUpdateImports = true;
                    logger.log("  renaming", record.moduleSpecifier, recordAbs);
                } else {
                    logger.log("  ignoring - could not find module", record.moduleSpecifier);
                }
            }
        }

        if (didUpdateImports) {
            const edits = editor.applyImportBlockToFile(sourceFile, newBlockBuilder.build());
            editGroups.push({ file: sourceFile.fileName, edits });
        } else {
            logger.log("  nothing to do");
        }

        logger.log("done processing", sourceFile.fileName);
    }

    return editGroups;
}
