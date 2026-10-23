/**
 * Custom Gherkin / Behave .feature document formatting (indentation, tags, tables).
 * Supports fine-grained custom indentation levels for Feature, Scenario, Background,
 * Given, When, Then, And, But.
 */

export const FORMAT_FEATURE_REGEX = /^(\s*)Feature:/i;
export const FORMAT_RULE_REGEX = /^(\s*)Rule:/i;
export const FORMAT_BACKGROUND_REGEX = /^(\s*)Background:/i;
export const FORMAT_SCENARIO_REGEX = /^(\s*)Scenario(?: Outline)?:/i;
export const FORMAT_EXAMPLES_REGEX = /^(\s*)Examples:/i;
export const FORMAT_STEP_REGEX = /^(\s*)(Given|When|Then|And|But|\*)\s+/i;
export const FORMAT_GIVEN_REGEX = /^(\s*)Given\s+/i;
export const FORMAT_WHEN_REGEX = /^(\s*)When\s+/i;
export const FORMAT_THEN_REGEX = /^(\s*)Then\s+/i;
export const FORMAT_AND_REGEX = /^(\s*)And\s+/i;
export const FORMAT_BUT_REGEX = /^(\s*)But\s+/i;
export const FORMAT_STAR_REGEX = /^(\s*)\*\s+/;
export const FORMAT_TAG_REGEX = /^(\s*)@/;
export const FORMAT_TABLE_REGEX = /^(\s*)\|/;
export const FORMAT_DOC_STRING_REGEX = /^(\s*)(""")/;
export const FORMAT_COMMENT_REGEX = /^(\s*)#/;
export const FORMAT_EMPTY_REGEX = /^\s*$/;

export interface CustomIndentationConfig {
  enabled?: boolean;
  indentCharacter?: "tab" | "spaces" | "auto";
  feature?: number;
  scenario?: number;
  background?: number;
  rule?: number;
  scenarioOutline?: number;
  examples?: number;
  given?: number;
  when?: number;
  then?: number;
  and?: number;
  but?: number;
  star?: number;
  table?: number;
  docstring?: number;
  relativeAnd?: boolean;
}

export type FeatureFormatOptions = {
  insertSpaces: boolean;
  tabSize: number;
  customIndent?: CustomIndentationConfig;
};

/** One line fully replaced (line index, new line text without newline). */
export type FeatureLineEdit = { line: number; newText: string };

export const DEFAULT_CUSTOM_INDENT: Required<
  Omit<CustomIndentationConfig, "table" | "docstring" | "scenarioOutline">
> = {
  enabled: true,
  indentCharacter: "auto",
  feature: 0,
  scenario: 1,
  background: 1,
  rule: 1,
  examples: 2,
  given: 2,
  when: 2,
  then: 3,
  and: 4,
  but: 4,
  star: 2,
  relativeAnd: false,
};

interface TableSection {
  startLine: number;
  endLine: number;
  columnWidths: number[];
  rows: string[][];
  parentStepLevel?: number;
  inExamples: boolean;
}

function getIndentUnit(options: FeatureFormatOptions): string {
  const charChoice = options.customIndent?.indentCharacter ?? "auto";
  if (charChoice === "tab") {
    return "\t";
  }
  if (charChoice === "spaces") {
    return " ".repeat(Math.max(1, options.tabSize || 4));
  }
  // "auto": respect VS Code editor options
  return options.insertSpaces ? " ".repeat(Math.max(1, options.tabSize || 4)) : "\t";
}

function getIndentStringForLevel(level: number, unit: string): string {
  return unit.repeat(Math.max(0, level));
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
  let inExamples = false;
  let lastStepLevel = 2;

  for (let lineNum = 0; lineNum <= endLine; lineNum++) {
    const text = lines[lineNum] ?? "";

    if (FORMAT_EXAMPLES_REGEX.test(text)) {
      inExamples = true;
    } else if (
      FORMAT_FEATURE_REGEX.test(text) ||
      FORMAT_SCENARIO_REGEX.test(text) ||
      FORMAT_BACKGROUND_REGEX.test(text) ||
      FORMAT_RULE_REGEX.test(text)
    ) {
      inExamples = false;
      lastStepLevel = 2;
    } else if (FORMAT_STEP_REGEX.test(text)) {
      inExamples = false;
      if (FORMAT_GIVEN_REGEX.test(text)) lastStepLevel = 2;
      else if (FORMAT_WHEN_REGEX.test(text)) lastStepLevel = 2;
      else if (FORMAT_THEN_REGEX.test(text)) lastStepLevel = 3;
      else if (FORMAT_AND_REGEX.test(text)) lastStepLevel = 4;
      else if (FORMAT_BUT_REGEX.test(text)) lastStepLevel = 4;
    }

    if (lineNum < startLine) {
      continue;
    }

    const isTableLine = FORMAT_TABLE_REGEX.test(text);
    if (isTableLine) {
      if (!currentSection) {
        currentSection = {
          startLine: lineNum,
          endLine: lineNum,
          columnWidths: [],
          rows: [],
          inExamples,
          parentStepLevel: lastStepLevel,
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
  const unit = getIndentUnit(options);

  const custom = {
    ...DEFAULT_CUSTOM_INDENT,
    ...(options.customIndent || {}),
  };

  const lineCount = lines.length;
  const safeEnd = Math.min(endLine, Math.max(0, lineCount - 1));
  const safeStart = Math.max(0, startLine);

  const tableSections = collectTableSections(lines, safeStart, safeEnd);

  let inDocString = false;
  let inExamples = false;
  let lastStepLevel = custom.given;
  let docStringLines: { line: number; text: string }[] = [];
  let docStringLevel = custom.given + 1;

  for (let lineNum = safeStart; lineNum <= safeEnd; lineNum++) {
    const text = lines[lineNum] ?? "";

    // 1. Docstrings
    if (FORMAT_DOC_STRING_REGEX.test(text)) {
      const indent = getIndentStringForLevel(docStringLevel, unit);
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
              const bodyIndent = getIndentStringForLevel(docStringLevel + 1, unit);
              if (jsonLines.length === docStringLines.length) {
                for (let k = 0; k < jsonLines.length; k++) {
                  const newLine = bodyIndent + jsonLines[k];
                  if (newLine !== docStringLines[k].text) {
                    edits.push({ line: docStringLines[k].line, newText: newLine });
                  }
                }
              }
            } catch {
              // Not JSON, leave as is
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

    // 2. Empty Lines
    if (FORMAT_EMPTY_REGEX.test(text)) {
      if (text !== "") {
        edits.push({ line: lineNum, newText: "" });
      }
      continue;
    }

    // 3. Tables
    const tableSection = tableSections.find(
      (s) => lineNum >= s.startLine && lineNum <= s.endLine
    );
    if (tableSection) {
      const rowIndex = lineNum - tableSection.startLine;
      const cells = tableSection.rows[rowIndex];

      let tableLevel: number;
      if (options.customIndent?.table !== undefined) {
        tableLevel = options.customIndent.table;
      } else if (tableSection.inExamples) {
        tableLevel = custom.examples + 1;
      } else {
        tableLevel = (tableSection.parentStepLevel ?? custom.given) + 1;
      }

      const indent = getIndentStringForLevel(tableLevel, unit);
      const formattedCells = cells.map((cell, index) => {
        const width = tableSection.columnWidths[index];
        return " " + cell.padEnd(width) + " ";
      });
      const formattedTable = indent + "|" + formattedCells.join("|") + "|";

      if (formattedTable !== text) {
        edits.push({ line: lineNum, newText: formattedTable });
      }
      continue;
    }

    // 4. Feature Keywords
    let formatted: string;

    if (FORMAT_FEATURE_REGEX.test(text)) {
      formatted = getIndentStringForLevel(custom.feature, unit) + text.trim();
      inExamples = false;
      lastStepLevel = custom.given;
    } else if (FORMAT_RULE_REGEX.test(text)) {
      formatted = getIndentStringForLevel(custom.rule, unit) + text.trim();
      inExamples = false;
      lastStepLevel = custom.given;
    } else if (FORMAT_BACKGROUND_REGEX.test(text)) {
      formatted = getIndentStringForLevel(custom.background, unit) + text.trim();
      inExamples = false;
      lastStepLevel = custom.given;
    } else if (FORMAT_SCENARIO_REGEX.test(text)) {
      const scenarioLevel = text.trim().toLowerCase().startsWith("scenario outline")
        ? (options.customIndent?.scenarioOutline ?? custom.scenario)
        : custom.scenario;
      formatted = getIndentStringForLevel(scenarioLevel, unit) + text.trim();
      inExamples = false;
      lastStepLevel = custom.given;
    } else if (FORMAT_EXAMPLES_REGEX.test(text)) {
      formatted = getIndentStringForLevel(custom.examples, unit) + text.trim();
      inExamples = true;
    } else if (FORMAT_STEP_REGEX.test(text)) {
      inExamples = false;
      const trimmed = text.trim();
      let stepLevel = custom.given;

      if (FORMAT_GIVEN_REGEX.test(trimmed)) {
        stepLevel = custom.given;
      } else if (FORMAT_WHEN_REGEX.test(trimmed)) {
        stepLevel = custom.when;
      } else if (FORMAT_THEN_REGEX.test(trimmed)) {
        stepLevel = custom.then;
      } else if (FORMAT_AND_REGEX.test(trimmed)) {
        stepLevel = custom.relativeAnd ? lastStepLevel + 1 : custom.and;
      } else if (FORMAT_BUT_REGEX.test(trimmed)) {
        stepLevel = custom.relativeAnd ? lastStepLevel + 1 : custom.but;
      } else if (FORMAT_STAR_REGEX.test(trimmed)) {
        stepLevel = custom.star;
      }

      lastStepLevel = stepLevel;
      docStringLevel = stepLevel + 1;

      const normalized = trimmed.replace(
        /^(Given|When|Then|And|But|\*)\s+/i,
        "$1 "
      );
      formatted = getIndentStringForLevel(stepLevel, unit) + normalized;
    } else if (FORMAT_TAG_REGEX.test(text)) {
      const nextNonEmpty = findNextNonEmptyLine(
        lines,
        lineNum + 1,
        safeEnd,
        lineCount
      );
      let tagLevel = custom.feature;
      if (nextNonEmpty) {
        if (FORMAT_FEATURE_REGEX.test(nextNonEmpty)) {
          tagLevel = custom.feature;
        } else if (FORMAT_RULE_REGEX.test(nextNonEmpty)) {
          tagLevel = custom.rule;
        } else if (FORMAT_BACKGROUND_REGEX.test(nextNonEmpty)) {
          tagLevel = custom.background;
        } else if (FORMAT_SCENARIO_REGEX.test(nextNonEmpty)) {
          tagLevel = custom.scenario;
        } else if (FORMAT_EXAMPLES_REGEX.test(nextNonEmpty)) {
          tagLevel = custom.examples;
        } else if (FORMAT_STEP_REGEX.test(nextNonEmpty)) {
          tagLevel = custom.given;
        }
      }
      const normalizedTags = text.trim().replace(/\s+@/g, " @");
      formatted = getIndentStringForLevel(tagLevel, unit) + normalizedTags;
    } else if (FORMAT_COMMENT_REGEX.test(text)) {
      formatted = text.trimEnd();
    } else {
      // Freeform description text under Feature / Scenario
      const descLevel = inExamples ? custom.examples : custom.scenario;
      formatted = getIndentStringForLevel(descLevel, unit) + text.trim();
    }

    if (formatted !== text) {
      edits.push({ line: lineNum, newText: formatted });
    }
  }

  return edits;
}

/**
 * Format a full Gherkin feature text string and return the formatted string.
 */
export function formatGherkinDocument(
  source: string,
  options?: Partial<FeatureFormatOptions>
): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const opts: FeatureFormatOptions = {
    insertSpaces: options?.insertSpaces ?? true,
    tabSize: options?.tabSize ?? 4,
    customIndent: {
      ...DEFAULT_CUSTOM_INDENT,
      ...(options?.customIndent || {}),
    },
  };

  const edits = computeFeatureFormatLineEdits(lines, 0, lines.length - 1, opts);
  const resultLines = [...lines];
  for (const edit of edits) {
    resultLines[edit.line] = edit.newText;
  }
  return resultLines.join(eol);
}
