import { TextDocument } from "vscode-languageserver-textdocument";
import * as server from "vscode-languageserver/node";
import { CodeActionParams, Command, Position } from "vscode-languageserver/node";
import { ITsqlLintError } from "./parseError";

interface IEdit {
  range: { start: server.Position; end: server.Position };
  newText: string;
}

interface IDiagnosticCommands {
  error: ITsqlLintError;
  fileVersion: number;
  disableLine: IEdit[];
}

const commandStore: { [fileUri: string]: IDiagnosticCommands[] } = {};

export const registerFileErrors = (file: TextDocument, errors: ITsqlLintError[]) => {
  const lines = file.getText().split("\n");

  const toDiagnosticCommands = (error: ITsqlLintError): IDiagnosticCommands => {
    const { start, end } = error.range;

    const spaceMatch = /^\s*/.exec(lines[start.line]);
    const space = spaceMatch === null ? "" : spaceMatch[0];

    const getDisableEdit = (): IEdit[] => {
      const { rule } = error;
      const line = lines[start.line];
      return [
        {
          range: { start: { ...start, character: 0 }, end },
          newText: `${space}/* tsqllint-disable ${rule} */\n${line}\n${space}/* tsqllint-enable ${rule} */\n`
        }
      ];
    };

    return {
      error,
      fileVersion: file.version,
      disableLine: getDisableEdit()
    };
  };

  commandStore[file.uri] = errors.map(toDiagnosticCommands);
};

export const getCommands = (params: CodeActionParams): Command[] => {
  const findCommands = (fileUri: string, { start, end }: server.Range): IDiagnosticCommands[] => {
    const fileCommands = Object.prototype.hasOwnProperty.call(commandStore, fileUri) ? commandStore[fileUri] : [];

    const comparePos = (a: Position, b: Position) => {
      if (a.line !== b.line) {
        return a.line - b.line;
      }
      return a.character - b.character;
    };

    return fileCommands.filter(({ error }): boolean => {
      const eStart = error.range.start;
      const eEnd = error.range.end;
      if (comparePos(eEnd, start) < 0) {
        return false;
      }
      if (comparePos(eStart, end) > 0) {
        return false;
      }
      return true;
    });
  };
  const commands = findCommands(params.textDocument.uri, params.range);

  const getDisableCommands = (): Command[] => {
    const toDisableCommand = (command: IDiagnosticCommands) => {
      return server.Command.create(
        `Disable: ${command.error.rule} for this line`,
        "_tsql-lint.change",
        params.textDocument.uri,
        command.fileVersion,
        command.disableLine
      );
    };

    const toDisableForFileCommand = (command: IDiagnosticCommands) => {
      const pos = { line: 0, character: 0 };
      const edit: IEdit = {
        range: { start: pos, end: pos },
        newText: `/* tsqllint-disable ${command.error.rule} */\n`
      };

      return server.Command.create(
        `Disable: ${command.error.rule} for this file`,
        "_tsql-lint.change",
        params.textDocument.uri,
        command.fileVersion,
        [edit]
      );
    };

    return [...commands.map(toDisableCommand), ...commands.map(toDisableForFileCommand)];
  };

  return [
    ...getDisableCommands()
    // TODO fix/fixall commands
    // TODO documentation commands
  ];
};
