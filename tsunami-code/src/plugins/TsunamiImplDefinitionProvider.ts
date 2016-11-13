import { uniq } from "lodash";
import * as vs from "vscode";
import * as ts from "typescript";
import { TsunamiContext } from "@derander/tsunami";
import { TsunamiPlugin } from "../TsunamiPlugin";
import { TS_MODE } from "../TypescriptDocumentFilter";

// naive implementation - will have false positives! but, still useful

export class TsunamiImplDefinitionProvider implements TsunamiPlugin {
    constructor(private context: TsunamiContext) { }

    public bindToContext(extContext: vs.ExtensionContext): void {
        const definitionProvider = new ImplDefinitionProvider(this.context);
        extContext.subscriptions.push(vs.languages.registerDefinitionProvider(TS_MODE, definitionProvider));
    }
}

class ImplDefinitionProvider implements vs.DefinitionProvider {
    constructor(private context: TsunamiContext) { }

    private didExecuteDefinitionProvider: boolean = false;

    public async provideDefinition(
        document: vs.TextDocument,
        position: vs.Position,
        token: vs.CancellationToken
    ): Promise<vs.Definition | null> {
        try {
            if (this.didExecuteDefinitionProvider) {
                return null;
            }

            this.didExecuteDefinitionProvider = true;
            const extLocations: vs.Location[] = await vs.commands.executeCommand(
                "vscode.executeDefinitionProvider", document.uri, position) as vs.Location[];
            this.didExecuteDefinitionProvider = false;

            return this.provideDefinitionHelper(document, position, extLocations);
        } catch (err) {
            console.error(err);
            return null;
        }
    }

    private async provideDefinitionHelper(document: vs.TextDocument, position: vs.Position, extLocations: vs.Location[]) {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }
        const word = document.getText(wordRange);

        const fileNames = await this.context.getProject().getFileNames();
        const sourceFiles = await Promise.all(fileNames.map(fileName => this.context.getSourceFileFor(fileName)));
        const interfaceSourceFiles = filterSourceFilesByExtLocations(sourceFiles, extLocations);

        const signatures = collectMatchingInterfaceSignatures(interfaceSourceFiles, { symbolName: word });
        const interfaceNames = getInterfaceNamesForSignatures(signatures);
        const declarations = collectMatchingClassDeclarations(sourceFiles, { symbolName: word, implementsSomeInterface: interfaceNames });
        const locations = convertDeclarationsToLocations(declarations);

        return locations;
    }
}

function filterSourceFilesByExtLocations(sourceFiles: ts.SourceFile[], extLocations: vs.Location[]): ts.SourceFile[] {
    return sourceFiles.filter(sourceFile => {
        for (let extLocation of extLocations) {
            if (extLocation.uri.fsPath === sourceFile.fileName) {
                return true;
            }
        }
        return false;
    });
}

type Signature = ts.PropertySignature | ts.MethodSignature;

function collectMatchingInterfaceSignatures(sourceFiles: ts.SourceFile[], criteria: {
    symbolName: string;
}): Signature[] {
    const signatures: Signature[] = [];
    for (let sourceFile of sourceFiles) {
        ts.forEachChild(sourceFile, node => {
            if (isNodeExported(node) && node.kind === ts.SyntaxKind.InterfaceDeclaration) {
                ts.forEachChild(node, child => {
                    if (child.kind === ts.SyntaxKind.PropertySignature) {
                        const propertySignature = child as ts.PropertySignature;
                        if (propertySignature.name.getText() === criteria.symbolName) {
                            signatures.push(propertySignature);
                        }
                    } else if (child.kind === ts.SyntaxKind.MethodSignature) {
                        const methodSignature = child as ts.MethodSignature;
                        if (methodSignature.name.getText() === criteria.symbolName) {
                            signatures.push(methodSignature);
                        }
                    }
                });
            }
        });
    }
    return signatures;
}

type Declaration = ts.PropertyDeclaration | ts.MethodDeclaration;

function collectMatchingClassDeclarations(sourceFiles: ts.SourceFile[], criteria: {
    implementsSomeInterface: string[];
    symbolName: string;
}): Declaration[] {
    const declarations: Declaration[] = [];
    for (let sourceFile of sourceFiles) {
        ts.forEachChild(sourceFile, node => {
            if (isNodeExported(node) && node.kind === ts.SyntaxKind.ClassDeclaration) {
                const classDeclaration = node as ts.ClassDeclaration;
                if (classImplementsSomeInterface(classDeclaration, criteria.implementsSomeInterface)) {
                    ts.forEachChild(node, child => {
                        if (child.kind === ts.SyntaxKind.PropertyDeclaration) {
                            const propertyDeclaration = child as ts.PropertyDeclaration;
                            if (propertyDeclaration.name.getText() === criteria.symbolName) {
                                declarations.push(propertyDeclaration);
                            }
                        } else if (child.kind === ts.SyntaxKind.MethodDeclaration) {
                            const methodDeclaration = child as ts.MethodDeclaration;
                            if (methodDeclaration.name.getText() === criteria.symbolName) {
                                declarations.push(methodDeclaration);
                            }
                        }
                    });
                }
            }
        });
    }
    return declarations;
}

function getInterfaceNamesForSignatures(signatures: Signature[]): string[] {
    const interfaceNames: string[] = [];
    for (let signature of signatures) {
        interfaceNames.push((signature.parent as ts.InterfaceDeclaration).name.getText());
    }
    return uniq(interfaceNames);
}

function classImplementsSomeInterface(classDeclaration: ts.ClassDeclaration, interfaceNames: string[]): boolean {
    if (classDeclaration.heritageClauses) {
        for (let heritage of classDeclaration.heritageClauses) {
            if (heritage.types) {
                for (let type of heritage.types) {
                    for (let interfaceName of interfaceNames) {
                        if (type.expression.getText() === interfaceName) {
                            return true;
                        }
                    }
                }
            }
        }
    }
    return false;
}

function isNodeExported(node: ts.Node): boolean {
    return (node.flags & ts.NodeFlags.Export) !== 0 ||
        (node.parent !== undefined && node.parent.kind === ts.SyntaxKind.SourceFile);
}

function convertDeclarationsToLocations(declarations: Declaration[]): vs.Location[] {
    const locations: vs.Location[] = [];
    declarations.forEach(candidate => {
        let parent: ts.Node | undefined = candidate.parent;
        while (parent && parent.kind !== ts.SyntaxKind.SourceFile) {
            parent = parent.parent;
        }
        if (!parent) {
            return;
        }

        const sourceFile = parent as ts.SourceFile;
        const uri = vs.Uri.file(sourceFile.fileName);

        const start = sourceFile.getLineAndCharacterOfPosition(candidate.getStart());
        const end = sourceFile.getLineAndCharacterOfPosition(candidate.getEnd());
        const range = new vs.Range(
            new vs.Position(start.line, start.character),
            new vs.Position(end.line, end.character));
        locations.push(new vs.Location(uri, range));
    });
    return locations;
}
