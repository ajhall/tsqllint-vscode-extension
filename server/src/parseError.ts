import { DiagnosticSeverity, Range } from "vscode-languageserver/node";

export interface ITSQLLintViolation {
  range: Range;
  message: string;
  rule: string;
  severity: DiagnosticSeverity;
}

const isValidViolation = (violation: ITSQLLintViolation): boolean => {
  return violation.range.start.line >= 0;
};

const isValidViolationString = (violationString: string): boolean => {
  const violationStringRegex = /^.*\(\d+,\d+\): \w+ .+ : .+$/;
  return violationStringRegex.test(violationString);
};

const matchDiagnosticSeverity = (severityName: string): DiagnosticSeverity => {
  switch (severityName) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    default:
      return DiagnosticSeverity.Information;
  }
};

export const parseTsqllintViolations = (docText: string, violationStrings: string[]): ITSQLLintViolation[] => {
  const lines = docText.split("\n");
  const lineStarts = lines.map((line) => {
    const spaceMatch = /^\s*/.exec(line);
    const space = spaceMatch === null ? "" : spaceMatch[0];
    return space.length;
  });

  const parseViolationString = (violationString: string): ITSQLLintViolation => {
    const violationParts: string[] = violationString.split(":", 3);

    const positionStr: string = violationParts[0].replace("(", "").replace(")", "");
    const positionArr: number[] = positionStr.split(",").map(Number);

    const severityAndRuleName: string[] = violationParts[1].trim().split(" ");
    const severity: DiagnosticSeverity = matchDiagnosticSeverity(severityAndRuleName[0]);

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
      message: violationParts[2].trim(),
      rule: violationParts[1].trim(),
      severity
    };
  };

  return violationStrings.filter(isValidViolationString).map(parseViolationString).filter(isValidViolation);
};
