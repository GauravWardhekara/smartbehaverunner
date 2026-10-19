import {
  consumeMultilineDocstringLine,
  type MultilineDocstringState,
} from "./featureDocstring";
import { StepKeyword } from "./types";
import { parseStepLine } from "./stepMatcher";

export type ParsedStep = {
  keyword: string;
  text: string;
  effectiveKeyword: StepKeyword | null;
  line: number;
};

/** One expanded row from a Scenario Outline (Behave-style name for `-n`). */
export type ParsedOutlineExpansion = {
  behaveName: string;
  /** 0-based line of this Examples data row in the feature file. */
  line: number;
};

export type ParsedScenario = {
  name: string;
  line: number;
  isOutline: boolean;
  steps: ParsedStep[];
  /**
   * When set, the tree shows one scenario node per row (Behave `scenario_outline_annotation_schema` default).
   */
  outlineExpansions?: ParsedOutlineExpansion[];
};

export type ParsedBackground = {
  line: number;
  steps: ParsedStep[];
};

export type ParsedFeature = {
  name: string;
  line: number;
  filePath: string;
  background: ParsedBackground | null;
  scenarios: ParsedScenario[];
};

const FEATURE_RE = /^\s*Feature:\s*(.+)\s*$/;
const BACKGROUND_RE = /^\s*Background:\s*(.*)\s*$/;
const SCENARIO_RE = /^\s*Scenario:\s*(.+)\s*$/;
const SCENARIO_OUTLINE_RE = /^\s*Scenario Outline:\s*(.+)\s*$/;
const EXAMPLES_RE = /^\s*Examples:\s*(.*)\s*$/;
const RULE_RE = /^\s*Rule:\s*(.+)\s*$/;

function splitTableRow(line: string): string[] {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) {
    return [];
  }
  return t
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
}

/** Gherkin separator rows (e.g. `|---|:---|`) contain no data or placeholders. */
function isSeparatorTableRow(cells: string[]): boolean {
  if (cells.length === 0) {
    return false;
  }
  return cells.every((c) => c.length > 0 && !/[0-9a-zA-Z<]/.test(c));
}

/**
 * Behave default: `ScenarioOutlineBuilder.annotation_schema = "{name} -- @{row.id} {examples.name}"`
 * with `row.id` = "{examplesBlockIndex}.{dataRowIndex}" (1-based), `examples.name` = Examples title or empty.
 */
function behaveOutlineScenarioName(
  outlineName: string,
  examplesBlockIndex: number,
  dataRowIndex: number,
  examplesBlockTitle: string
): string {
  const rowId = `${examplesBlockIndex}.${dataRowIndex}`;
  const title = examplesBlockTitle.trim();
  if (title.length > 0) {
    return `${outlineName} -- @${rowId} ${title}`;
  }
  return `${outlineName} -- @${rowId}`;
}

/**
 * Parse a Gherkin .feature file into feature metadata, optional background, and scenarios with steps.
 */
export function parseFeatureFile(filePath: string, content: string): ParsedFeature {
  const lines = content.split(/\r?\n/);
  let featureName = "";
  let featureLine = 0;
  let background: ParsedBackground | null = null;
  const scenarios: ParsedScenario[] = [];

  let previousKeyword: StepKeyword | null = null;
  const docState: MultilineDocstringState = { active: false, delim: null };
  let inFeature = false;
  let collectingBackground = false;
  let currentScenario: ParsedScenario | null = null;
  let inExamplesTable = false;
  let outlineExamplesBlockIndex = 0;
  let examplesExpectHeaderRow = false;
  let examplesDataRowIndex = 0;
  let currentExamplesTitle = "";

  const flushScenario = (): void => {
    if (currentScenario) {
      scenarios.push(currentScenario);
      currentScenario = null;
    }
    previousKeyword = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();

    if (consumeMultilineDocstringLine(line, docState)) {
      continue;
    }

    if (trimmed.startsWith("#") || trimmed === "") {
      continue;
    }

    if (inExamplesTable && !trimmed.startsWith("|")) {
      inExamplesTable = false;
    }

    const featureMatch = line.match(FEATURE_RE);
    if (featureMatch) {
      featureName = featureMatch[1].trim();
      featureLine = lineIndex;
      inFeature = true;
      collectingBackground = false;
      flushScenario();
      background = null;
      previousKeyword = null;
      inExamplesTable = false;
      outlineExamplesBlockIndex = 0;
      docState.active = false;
      docState.delim = null;
      continue;
    }

    if (!inFeature) {
      continue;
    }

    if (RULE_RE.test(line)) {
      collectingBackground = false;
      flushScenario();
      previousKeyword = null;
      inExamplesTable = false;
      outlineExamplesBlockIndex = 0;
      continue;
    }

    const bgMatch = line.match(BACKGROUND_RE);
    if (bgMatch) {
      flushScenario();
      collectingBackground = true;
      background = { line: lineIndex, steps: [] };
      previousKeyword = null;
      inExamplesTable = false;
      outlineExamplesBlockIndex = 0;
      continue;
    }

    const outlineMatch = line.match(SCENARIO_OUTLINE_RE);
    if (outlineMatch) {
      collectingBackground = false;
      flushScenario();
      const name = outlineMatch[1].trim();
      currentScenario = {
        name,
        line: lineIndex,
        isOutline: true,
        steps: []
      };
      previousKeyword = null;
      inExamplesTable = false;
      outlineExamplesBlockIndex = 0;
      continue;
    }

    const scenarioMatch = line.match(SCENARIO_RE);
    if (scenarioMatch) {
      collectingBackground = false;
      flushScenario();
      const name = scenarioMatch[1].trim();
      currentScenario = {
        name,
        line: lineIndex,
        isOutline: false,
        steps: []
      };
      previousKeyword = null;
      inExamplesTable = false;
      outlineExamplesBlockIndex = 0;
      continue;
    }

    const examplesMatch = line.match(EXAMPLES_RE);
    if (examplesMatch) {
      inExamplesTable = true;
      previousKeyword = null;
      currentExamplesTitle = examplesMatch[1].trim();
      if (currentScenario?.isOutline) {
        outlineExamplesBlockIndex += 1;
        examplesExpectHeaderRow = true;
        examplesDataRowIndex = 0;
        currentScenario.outlineExpansions = currentScenario.outlineExpansions ?? [];
      }
      continue;
    }

    if (inExamplesTable && trimmed.startsWith("|")) {
      if (currentScenario?.isOutline && currentScenario.outlineExpansions) {
        const cells = splitTableRow(line);
        if (cells.length === 0) {
          continue;
        }
        if (isSeparatorTableRow(cells)) {
          continue;
        }
        if (examplesExpectHeaderRow) {
          examplesExpectHeaderRow = false;
          examplesDataRowIndex = 0;
          continue;
        }
        examplesDataRowIndex += 1;
        const behaveName = behaveOutlineScenarioName(
          currentScenario.name,
          outlineExamplesBlockIndex,
          examplesDataRowIndex,
          currentExamplesTitle
        );
        currentScenario.outlineExpansions.push({
          behaveName,
          line: lineIndex
        });
      }
      continue;
    }

    if (
      line.match(/^\s*(Feature|Scenario|Scenario Outline|Background|Rule):/i)
    ) {
      previousKeyword = null;
      continue;
    }

    const stepInfo = parseStepLine(line, previousKeyword);
    if (!stepInfo) {
      if (trimmed.startsWith("@") || trimmed.startsWith("|")) {
        continue;
      }
      if (collectingBackground && background) {
        const resetKeywords = /^\s*(Examples|Scenario|Scenario Outline|Rule):/i;
        if (resetKeywords.test(line)) {
          collectingBackground = false;
        }
      }
      continue;
    }

    const step: ParsedStep = {
      keyword: stepInfo.keyword,
      text: stepInfo.text,
      effectiveKeyword: stepInfo.effectiveKeyword,
      line: lineIndex
    };

    if (stepInfo.effectiveKeyword) {
      previousKeyword = stepInfo.effectiveKeyword;
    }

    if (collectingBackground && background) {
      background.steps.push(step);
      continue;
    }

    if (currentScenario) {
      if (inExamplesTable) {
        continue;
      }
      currentScenario.steps.push(step);
    }
  }

  flushScenario();

  return {
    name: featureName || pathBasename(filePath),
    line: featureLine,
    filePath,
    background,
    scenarios
  };
}

function pathBasename(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? filePath;
}
