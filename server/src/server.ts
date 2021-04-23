"use strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as uid from "uid-safe";
import { sync as which } from "which";
import {
  createConnection,
  Diagnostic,
  InitializeResult,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  _Connection
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ChildProcess, spawn } from "child_process";
import { ITSQLLintViolation, parseTsqllintViolations } from "./parseError";
import { getCommands, registerFileViolations } from "./commands";

const buildTempFilePath = (textDocument: TextDocument) => {
  const ext = path.extname(textDocument.uri) || ".sql";
  const name = uid.sync(18) + ext;
  return path.join(os.tmpdir(), name);
};

const toDiagnostic = (lintError: ITSQLLintViolation): Diagnostic => {
  return {
    severity: lintError.severity,
    range: lintError.range,
    message: lintError.message,
    source: `TSQLLint: ${lintError.rule}`
  };
};

const parseChildProcessResult = (
  childProcess: ChildProcess,
  callback: (error: Error | null, result: string[]) => void
) => {
  let processStdout: string;
  childProcess.stdout?.on("data", (data: string) => {
    processStdout += data;
  });

  childProcess.stderr?.on("data", (data: string) => {
    process.stderr.write(`stderr: ${data}\n`);
  });

  childProcess.on("close", () => {
    const stdoutLines: string[] = processStdout.split("\n");
    const violationMessages: string[] = [];

    stdoutLines.forEach((line) => {
      const index = line.indexOf("(");
      if (index > 0) {
        violationMessages.push(line.substring(index, line.length - 1));
      }
    });

    callback(null, violationMessages);
  });
};

const lintBuffer = (
  fileUri: string,
  tsqllintPath: string,
  callback: (error: Error | null, result: string[]) => void
): void => {
  const childProcess = spawn(tsqllintPath, [fileUri]);
  parseChildProcessResult(childProcess, callback);
};

const validateBuffer = (textDocument: TextDocument, connection: _Connection, tsqllintPath: string): void => {
  const tempFilePath: string = buildTempFilePath(textDocument);
  fs.writeFileSync(tempFilePath, textDocument.getText());

  lintBuffer(tempFilePath, tsqllintPath, (error: Error | null, lintErrorStrings: string[]) => {
    if (error !== null) {
      registerFileViolations(textDocument, []);
      throw error;
    }

    const errors = parseTsqllintViolations(textDocument.getText(), lintErrorStrings);
    registerFileViolations(textDocument, errors);

    const diagnostics = errors.map(toDiagnostic);
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

    fs.unlinkSync(tempFilePath);
  });
};

const activateExtension = (tsqllintPath: string) => {
  process.stdout.write("Activating TSQLLint extension.\n");
  const connection = createConnection(ProposedFeatures.all);
  connection.onInitialize(
    (): InitializeResult => {
      return {
        capabilities: {
          textDocumentSync: TextDocumentSyncKind.Full,
          codeActionProvider: true
        }
      };
    }
  );

  connection.onCodeAction(getCommands);

  const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
  documents.listen(connection);
  documents.onDidChangeContent((change: { document: TextDocument }) => {
    validateBuffer(change.document, connection, tsqllintPath);
  });

  connection.listen();
};

try {
  const resolvedPath = which("tsqllint");
  process.stdout.write(`Found TSQLLint at ${resolvedPath}\n`);
  activateExtension(resolvedPath);
} catch (error) {
  process.stderr.write(
    "The tsqllint executable was not found on the PATH. The TSQLLint extension will not be activated.\n"
  );
}
