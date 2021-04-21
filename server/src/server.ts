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
import { ITSQLLintViolation, parseErrors } from "./parseError";
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

const lintBuffer = (fileUri: string, callback: (error: Error | null, result: string[]) => void): void => {
  const childProcess = spawn("tsqllint", [fileUri]);
  parseChildProcessResult(childProcess, callback);
};

const validateBuffer = (textDocument: TextDocument, connection: _Connection): void => {
  const tempFilePath: string = buildTempFilePath(textDocument);
  fs.writeFileSync(tempFilePath, textDocument.getText());

  lintBuffer(tempFilePath, (error: Error | null, lintErrorStrings: string[]) => {
    if (error !== null) {
      registerFileViolations(textDocument, []);
      throw error;
    }

    const errors = parseErrors(textDocument.getText(), lintErrorStrings);
    registerFileViolations(textDocument, errors);

    const diagnostics = errors.map(toDiagnostic);
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

    fs.unlinkSync(tempFilePath);
  });
};

const ActivateExtension = () => {
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
    validateBuffer(change.document, connection);
  });

  connection.listen();
};

const extensionNotActivatedMessage =
  "The tsqllint executable was not found on the PATH. The TSQLLint extension will not be activated.\n";

try {
  const resolvedPath = which("tsqllint");
  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension === ".exe" || extension === "") {
    process.stdout.write(`Found TSQLLint executable at ${resolvedPath}\n`);
    ActivateExtension();
  } else {
    process.stderr.write(`Found TSQLLint at ${resolvedPath}, but it did not appear to be an executable binary.\n`);
    process.stderr.write(extensionNotActivatedMessage);
  }
} catch (error) {
  process.stderr.write(extensionNotActivatedMessage);
}
