import { ModuleSpecifier } from "@derander/tsunami";

export function filenameToModuleSpecifier(filename: string): ModuleSpecifier {
    return filename
        .replace(".tsx", "")
        .replace(".ts", "") as ModuleSpecifier;
}
