import { RegionSpan } from "../protocol/types";
import { getErrorOutputForCommand, Response, getBlankResponseForCommand } from "../Response";
import { getScopesContainingPoint } from "../ScopeTree";
import { TsunamiContext } from "../Context";
import log from "../log";
import { Command, CommandDefinition } from "../Command";

export interface GetContainingScopesCommand extends Command {
    arguments: {
        file: string;
        line: number;
        offset: number;
    };
}

export class GetContainingScopesDefinition implements CommandDefinition<GetContainingScopesCommand> {
    public predicate(command: Command): command is GetContainingScopesCommand {
        return command.command === "GET_CONTAINING_SCOPES";
    }

    public processor(context: TsunamiContext, command: GetContainingScopesCommand): Promise<void> {
        const { line, offset, file } = command.arguments;

        return context.getSourceFileFor(file).then(sourceFile => {
            const response: Response<RegionSpan[]> = getBlankResponseForCommand(command);
            const position = sourceFile.getPositionOfLineAndCharacter(line, offset);
            const scopes = getScopesContainingPoint(sourceFile, position);
            response.success = true;
            response.body = scopes.map(scope => ({ start: scope.getStart(), end: scope.getEnd()}));
            context.writeOutput(response);
        }).catch(e => {
            log("Error occurred containing getting scopes: ", e, e.stack);
            context.writeOutput(getErrorOutputForCommand(command, e));
        });
    }
};
