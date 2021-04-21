import { Range } from "vscode-languageserver/node";

export interface ITsqlLintError {
  range: Range;
  message: string;
  rule: string;
}

const isValidError = (error: ITsqlLintError): boolean => {
  return error.range.start.line >= 0;
};

export const parseErrors = (docText: string, errorStrings: string[]): ITsqlLintError[] => {
  const lines = docText.split("\n");
  const lineStarts = lines.map((line) => {
    const spaceMatch = /^\s*/.exec(line);
    const space = spaceMatch === null ? "" : spaceMatch[0];
    return space.length;
  });

  const parseError = (errorString: string): ITsqlLintError => {
    const validationError: string[] = errorString.split(":");
    const positionStr: string = validationError[0].replace("(", "").replace(")", "");
    const positionArr: number[] = positionStr.split(",").map(Number);

    const line = Math.max(positionArr[0] - 1, 0);
    const colStart = lineStarts[line];

    let colEnd = 0;
    if (lines[line]) {
      colEnd = lines[line].length;
    }

    const range: Range = {
      start: { line, character: colStart },
      end: { line, character: colEnd }
    };

    return {
      range,
      message: validationError[2].trim(),
      rule: validationError[1].trim()
    };
  };

  return errorStrings.map(parseError).filter(isValidError);
};
