import { TsunamiContext } from "@derander/tsunami";

export async function loadProjectSourceFiles(context: TsunamiContext) {
    const fileNames = await context.getProject().getFileNames();
    const sourceFilePromises = fileNames.map(file => context.getSourceFileFor(file));
    return Promise.all(sourceFilePromises);
}
