import { TextDocument } from "vscode-languageserver-textdocument";
import * as server from "vscode-languageserver/node";
import { CodeActionParams, Command, Position } from "vscode-languageserver/node";
import { ITSQLLintViolation } from "./parseError";

interface IEdit {
  range: { start: server.Position; end: server.Position };
  newText: string;
}

interface IDiagnosticCommands {
  violation: ITSQLLintViolation;
  fileVersion: number;
  disableLine: IEdit[];
}

const commandStore: { [fileUri: string]: IDiagnosticCommands[] } = {};

export const registerFileViolations = (file: TextDocument, errors: ITSQLLintViolation[]) => {
  const lines = file.getText().split("\n");

  const toDiagnosticCommands = (tsqlLintViolation: ITSQLLintViolation): IDiagnosticCommands => {
    const { start, end } = tsqlLintViolation.range;

    const spaceMatch = /^\s*/.exec(lines[start.line]);
    const space = spaceMatch === null ? "" : spaceMatch[0];

    const getDisableEdit = (): IEdit[] => {
      const { rule } = tsqlLintViolation;
      const line = lines[start.line];
      return [
        {
          range: { start: { ...start, character: 0 }, end },
          newText: `${space}/* tsqllint-disable ${rule} */\n${line}\n${space}/* tsqllint-enable ${rule} */\n`
        }
      ];
    };

    return {
      violation: tsqlLintViolation,
      fileVersion: file.version,
      disableLine: getDisableEdit()
    };
  };

  commandStore[file.uri] = errors.map(toDiagnosticCommands);
};

const findCommands = (fileUri: string, { start, end }: server.Range): IDiagnosticCommands[] => {
  const fileCommands = Object.prototype.hasOwnProperty.call(commandStore, fileUri) ? commandStore[fileUri] : [];

  const comparePos = (a: Position, b: Position) => {
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    return a.character - b.character;
  };

  return fileCommands.filter(({ violation }): boolean => {
    const eStart = violation.range.start;
    const eEnd = violation.range.end;
    if (comparePos(eEnd, start) < 0) {
      return false;
    }
    if (comparePos(eStart, end) > 0) {
      return false;
    }
    return true;
  });
};

export const getCommands = (params: CodeActionParams): Command[] => {
  const commands = findCommands(params.textDocument.uri, params.range);

  const getDisableCommands = (): Command[] => {
    const toDisableCommand = (command: IDiagnosticCommands) => {
      return server.Command.create(
        `Disable: ${command.violation.rule} for this line`,
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
        newText: `/* tsqllint-disable ${command.violation.rule} */\n`
      };

      return server.Command.create(
        `Disable: ${command.violation.rule} for this file`,
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
