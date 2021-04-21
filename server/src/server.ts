"use strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as uid from "uid-safe";
import { sync as commandExists } from "command-exists";
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
import { ITSQLLintViolation, parseErrors } from "./parseError";
import { getCommands, registerFileErrors } from "./commands";

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

    stdoutLines.forEach((element) => {
      const index = element.indexOf("(");
      if (index > 0) {
        violationMessages.push(element.substring(index, element.length - 1));
      }
    });

    callback(null, violationMessages);
  });
};

const lintBuffer = (fileUri: string, callback: (error: Error | null, result: string[]) => void): void => {
  const childProcess = spawn("tsqllint", [fileUri]);
  parseChildProcessResult(childProcess, callback);
};

const validateBuffer = (textDocument: TextDocument, connection: _Connection): void => {
  const tempFilePath: string = buildTempFilePath(textDocument);
  fs.writeFileSync(tempFilePath, textDocument.getText());

  lintBuffer(tempFilePath, (error: Error | null, lintErrorStrings: string[]) => {
    if (error !== null) {
      registerFileErrors(textDocument, []);
      throw error;
    }

    const errors = parseErrors(textDocument.getText(), lintErrorStrings);
    registerFileErrors(textDocument, errors);

    const diagnostics = errors.map(toDiagnostic);
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

    fs.unlinkSync(tempFilePath);
  });
};

const ActivateExtension = () => {
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
    validateBuffer(change.document, connection);
  });

  connection.listen();
};

if (commandExists("tsqllint")) {
  ActivateExtension();
} else {
  process.stderr.write(
    "The tsqllint command was not found on the PATH. The TSQLLint extension will not be activated.\n"
  );
}
