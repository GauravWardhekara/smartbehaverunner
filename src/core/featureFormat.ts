/**
 * Gherkin / Behave .feature document formatting (indentation, tags, tables).
 * Used by the language server; no VS Code or LSP types here.
 */

const FORMAT_FEATURE_REGEX = /^(\s*)Feature:/i;
const FORMAT_RULE_REGEX = /^(\s*)Rule:/i;
const FORMAT_BACKGROUND_REGEX = /^(\s*)Background:/i;
const FORMAT_SCENARIO_REGEX = /^(\s*)Scenario(?: Outline)?:/i;
const FORMAT_EXAMPLES_REGEX = /^(\s*)Examples:/i;
const FORMAT_STEP_REGEX = /^(\s*)(Given|When|Then|And|But|\*)\s+/i;
const FORMAT_TAG_REGEX = /^(\s*)@/;
const FORMAT_TABLE_REGEX = /^(\s*)\|/;
const FORMAT_DOC_STRING_REGEX = /^(\s*)(""")/;
const FORMAT_COMMENT_REGEX = /^(\s*)#/;
const FORMAT_EMPTY_REGEX = /^\s*$/;

const INDENT = {
  FEATURE: 0,
  RULE: 2,
  SCENARIO: 2,
  STEP: 4,
  TABLE: 6,
  EXAMPLES: 4,
  EXAMPLES_TABLE: 6
} as const;

export type FeatureFormatOptions = {
  insertSpaces: boolean;
  tabSize: number;
};

/** One line fully replaced (line index, new line text without newline). */
export type FeatureLineEdit = { line: number; newText: string };

interface TableSection {
  startLine: number;
  endLine: number;
  columnWidths: number[];
  rows: string[][];
}

function getIndentString(
  spaces: number,
  baseIndent: number,
  indentChar: string
): string {
  if (indentChar === "\t") {
    return "\t".repeat(Math.floor(spaces / baseIndent));
  }
  return " ".repeat(spaces);
}

function formatKeywordLine(
  text: string,
  indentSpaces: number,
  baseIndent: number,
  indentChar: string
): string {
  const indent = getIndentString(indentSpaces, baseIndent, indentChar);
  return indent + text.trim();
}

function formatStepLine(
  text: string,
  indentSpaces: number,
  baseIndent: number,
  indentChar: string
): string {
  const indent = getIndentString(indentSpaces, baseIndent, indentChar);
  const trimmed = text.trim();
  const normalized = trimmed.replace(
    /^(Given|When|Then|And|But|\*)\s+/i,
    "$1 "
  );
  return indent + normalized;
}

function formatTagLine(
  text: string,
  indentSpaces: number,
  baseIndent: number,
  indentChar: string
): string {
  const indent = getIndentString(indentSpaces, baseIndent, indentChar);
  const trimmed = text.trim();
  const normalized = trimmed.replace(/\s+@/g, " @");
  return indent + normalized;
}

function findNextNonEmptyLine(
  lines: readonly string[],
  startLine: number,
  endLine: number,
  lineCount: number
): string | null {
  const max = Math.min(endLine, lineCount - 1);
  for (let i = startLine; i <= max; i++) {
    const text = lines[i] ?? "";
    if (!FORMAT_EMPTY_REGEX.test(text)) {
      return text;
    }
  }
  return null;
}

function parseTableRow(text: string): string[] {
  const trimmed = text.trim();
  const content = trimmed.replace(/^\||\|$/g, "");
  return content.split("|").map((cell) => cell.trim());
}

function collectTableSections(
  lines: readonly string[],
  startLine: number,
  endLine: number
): TableSection[] {
  const sections: TableSection[] = [];
  let currentSection: TableSection | null = null;

  for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
    const text = lines[lineNum] ?? "";
    const isTableLine = FORMAT_TABLE_REGEX.test(text);

    if (isTableLine) {
      if (!currentSection) {
        currentSection = {
          startLine: lineNum,
          endLine: lineNum,
          columnWidths: [],
          rows: []
        };
      }
      currentSection.endLine = lineNum;
      const cells = parseTableRow(text);
      currentSection.rows.push(cells);

      cells.forEach((cell, index) => {
        const width = cell.length;
        if (index >= currentSection!.columnWidths.length) {
          currentSection!.columnWidths.push(width);
        } else if (width > currentSection!.columnWidths[index]) {
          currentSection!.columnWidths[index] = width;
        }
      });
    } else if (currentSection) {
      sections.push(currentSection);
      currentSection = null;
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}

function formatTableLine(
  _text: string,
  section: TableSection,
  lineNum: number,
  inRule: boolean,
  inExamples: boolean,
  baseIndent: number,
  indentChar: string
): string {
  const rowIndex = lineNum - section.startLine;
  const cells = section.rows[rowIndex];

  let tableIndent: number;
  if (inExamples) {
    tableIndent = inRule
      ? INDENT.EXAMPLES_TABLE + 2
      : INDENT.EXAMPLES_TABLE;
  } else {
    tableIndent = inRule ? INDENT.TABLE + 2 : INDENT.TABLE;
  }

  const indent = getIndentString(tableIndent, baseIndent, indentChar);

  const formattedCells = cells.map((cell, index) => {
    const width = section.columnWidths[index];
    return " " + cell.padEnd(width) + " ";
  });

  return indent + "|" + formattedCells.join("|") + "|";
}

/**
 * Compute per-line replacements for the inclusive line range [startLine, endLine].
 */
export function computeFeatureFormatLineEdits(
  lines: readonly string[],
  startLine: number,
  endLine: number,
  options: FeatureFormatOptions
): FeatureLineEdit[] {
  const edits: FeatureLineEdit[] = [];
  const indentChar = options.insertSpaces
    ? " ".repeat(options.tabSize)
    : "\t";
  const baseIndent = options.insertSpaces ? options.tabSize : 1;

  let inDocString = false;
  let inRule = false;
  let inExamples = false;
  let docStringLines: { line: number; text: string }[] = [];

  const lineCount = lines.length;
  const safeEnd = Math.min(endLine, Math.max(0, lineCount - 1));
  const safeStart = Math.max(0, startLine);

  const tableSections = collectTableSections(lines, safeStart, safeEnd);

  for (let lineNum = safeStart; lineNum <= safeEnd; lineNum++) {
    const text = lines[lineNum] ?? "";

    if (FORMAT_DOC_STRING_REGEX.test(text)) {
      const docIndent = inRule ? INDENT.STEP + 2 : INDENT.STEP;
      const indent = getIndentString(docIndent, baseIndent, indentChar);
      const formatted = indent + text.trim();
      if (formatted !== text) {
        edits.push({ line: lineNum, newText: formatted });
      }

      if (inDocString) {
        // Closing docstring: check if content is valid JSON
        if (docStringLines.length > 0) {
          const rawDoc = docStringLines.map((d) => d.text).join("\n").trim();
          if (
            (rawDoc.startsWith("{") && rawDoc.endsWith("}")) ||
            (rawDoc.startsWith("[") && rawDoc.endsWith("]"))
          ) {
            try {
              const parsed = JSON.parse(rawDoc);
              const formattedJson = JSON.stringify(parsed, null, 2);
              const jsonLines = formattedJson.split("\n");
              const bodyIndent = getIndentString(docIndent + 2, baseIndent, indentChar);
              if (jsonLines.length === docStringLines.length) {
                for (let k = 0; k < jsonLines.length; k++) {
                  const newLine = bodyIndent + jsonLines[k];
                  if (newLine !== docStringLines[k].text) {
                    edits.push({ line: docStringLines[k].line, newText: newLine });
                  }
                }
              }
            } catch {
              // Not valid JSON, leave as is
            }
          }
        }
        docStringLines = [];
        inDocString = false;
      } else {
        docStringLines = [];
        inDocString = true;
      }
      continue;
    }

    if (inDocString) {
      docStringLines.push({ line: lineNum, text });
      continue;
    }

    if (FORMAT_EMPTY_REGEX.test(text)) {
      if (text !== "") {
        edits.push({ line: lineNum, newText: "" });
      }
      continue;
    }

    const tableSection = tableSections.find(
      (s) => lineNum >= s.startLine && lineNum <= s.endLine
    );

    if (tableSection) {
      const formattedTable = formatTableLine(
        text,
        tableSection,
        lineNum,
        inRule,
        inExamples,
        baseIndent,
        indentChar
      );
      if (formattedTable !== text) {
        edits.push({ line: lineNum, newText: formattedTable });
      }
      continue;
    }

    let formatted: string;

    if (FORMAT_FEATURE_REGEX.test(text)) {
      formatted = formatKeywordLine(
        text,
        INDENT.FEATURE,
        baseIndent,
        indentChar
      );
      inRule = false;
      inExamples = false;
    } else if (FORMAT_RULE_REGEX.test(text)) {
      formatted = formatKeywordLine(
        text,
        INDENT.RULE,
        baseIndent,
        indentChar
      );
      inRule = true;
      inExamples = false;
    } else if (FORMAT_BACKGROUND_REGEX.test(text)) {
      const indent = inRule ? INDENT.SCENARIO + 2 : INDENT.SCENARIO;
      formatted = formatKeywordLine(text, indent, baseIndent, indentChar);
      inExamples = false;
    } else if (FORMAT_SCENARIO_REGEX.test(text)) {
      const indent = inRule ? INDENT.SCENARIO + 2 : INDENT.SCENARIO;
      formatted = formatKeywordLine(text, indent, baseIndent, indentChar);
      inExamples = false;
    } else if (FORMAT_EXAMPLES_REGEX.test(text)) {
      const indent = inRule ? INDENT.EXAMPLES + 2 : INDENT.EXAMPLES;
      formatted = formatKeywordLine(text, indent, baseIndent, indentChar);
      inExamples = true;
    } else if (FORMAT_STEP_REGEX.test(text)) {
      const indent = inRule ? INDENT.STEP + 2 : INDENT.STEP;
      formatted = formatStepLine(text, indent, baseIndent, indentChar);
      inExamples = false;
    } else if (FORMAT_TAG_REGEX.test(text)) {
      const nextNonEmpty = findNextNonEmptyLine(
        lines,
        lineNum + 1,
        safeEnd,
        lineCount
      );
      let tagIndent: number = INDENT.FEATURE;
      if (nextNonEmpty) {
        if (FORMAT_FEATURE_REGEX.test(nextNonEmpty)) {
          tagIndent = INDENT.FEATURE;
        } else if (FORMAT_RULE_REGEX.test(nextNonEmpty)) {
          tagIndent = INDENT.RULE;
        } else if (
          FORMAT_SCENARIO_REGEX.test(nextNonEmpty) ||
          FORMAT_BACKGROUND_REGEX.test(nextNonEmpty)
        ) {
          tagIndent = inRule ? INDENT.SCENARIO + 2 : INDENT.SCENARIO;
        } else if (FORMAT_EXAMPLES_REGEX.test(nextNonEmpty)) {
          tagIndent = inRule ? INDENT.EXAMPLES + 2 : INDENT.EXAMPLES;
        }
      }
      formatted = formatTagLine(text, tagIndent, baseIndent, indentChar);
    } else if (FORMAT_COMMENT_REGEX.test(text)) {
      formatted = text.trimEnd();
    } else {
      const indent = inRule ? INDENT.SCENARIO : INDENT.RULE;
      formatted = getIndentString(indent, baseIndent, indentChar) + text.trim();
    }

    if (formatted !== text) {
      edits.push({ line: lineNum, newText: formatted });
    }
  }

  return edits;
}
