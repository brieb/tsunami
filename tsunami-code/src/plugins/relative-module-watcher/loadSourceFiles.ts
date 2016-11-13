import * as ts from "typescript";
import * as Bluebird from "bluebird";
import * as fs from "fs";

export async function loadSourceFiles(fileNames: string[]) {
    const sourceFilePromises = fileNames.map(fileName => getSourceFileFor(fileName));
    return Promise.all(sourceFilePromises);
}

const readFilePromise = Bluebird.promisify(fs.readFile);

function getSourceFileFor(filename: string): Promise<ts.SourceFile> {
    return readFilePromise(filename).then(buffer => {
        return ts.createSourceFile(filename, buffer.toString(), ts.ScriptTarget.ES5, true);
    });
}
