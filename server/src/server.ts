"use strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as uid from "uid-safe";
import { sync as commandExists } from "command-exists";
import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
  InitializeResult,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ChildProcess, spawn } from "child_process";
import { ITsqlLintError, parseErrors } from "./parseError";
import { getCommands, registerFileErrors } from "./commands";

const ActivateExtension = () => {
  const connection = createConnection(ProposedFeatures.all);
  const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
  documents.listen(connection);

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

  const buildTempFilePath = (textDocument: TextDocument) => {
    const ext = path.extname(textDocument.uri) || ".sql";
    const name = uid.sync(18) + ext;
    return path.join(os.tmpdir(), name);
  };

  const parseChildProcessResult = (
    childProcess: ChildProcess,
    callback: (error: Error | null, result: string[]) => void
  ) => {
    let result: string;
    childProcess.stdout?.on("data", (data: string) => {
      result += data;
    });

    childProcess.stderr?.on("data", (data: string) => {
      process.stderr.write(`stderr: ${data}\n`);
    });

    childProcess.on("close", () => {
      const list: string[] = result.split("\n");
      const resultsArr: string[] = [];

      list.forEach((element) => {
        const index = element.indexOf("(");
        if (index > 0) {
          resultsArr.push(element.substring(index, element.length - 1));
        }
      });

      callback(null, resultsArr);
    });
  };

  const lintBuffer = (fileUri: string, callback: (error: Error | null, result: string[]) => void): void => {
    const childProcess = spawn("tsqllint", [fileUri]);
    parseChildProcessResult(childProcess, callback);
  };

  const validateBuffer = (textDocument: TextDocument): void => {
    const tempFilePath: string = buildTempFilePath(textDocument);
    fs.writeFileSync(tempFilePath, textDocument.getText());

    lintBuffer(tempFilePath, (error: Error | null, lintErrorStrings: string[]) => {
      const toDiagnostic = (lintError: ITsqlLintError): Diagnostic => {
        return {
          severity: DiagnosticSeverity.Error,
          range: lintError.range,
          message: lintError.message,
          source: `TSQLLint: ${lintError.rule}`
        };
      };

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

  documents.onDidChangeContent((change: { document: TextDocument }) => {
    validateBuffer(change.document);
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
