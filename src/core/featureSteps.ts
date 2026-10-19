import {
  consumeMultilineDocstringLine,
  type MultilineDocstringState,
} from "./featureDocstring";
import { parseStepLine } from "./stepMatcher";
import type { FeatureStep, StepKeyword } from "./types";

/** Defaults aligned with extension `package.json` contributes.configuration. */
export const DEFAULT_FEATURE_FILE_PATTERNS = ["**/*.feature"];

/**
 * Extract step occurrences from a `.feature` file body (Gherkin steps only).
 */
export function extractFeatureStepsFromContent(
  filePath: string,
  content: string
): FeatureStep[] {
  const steps: FeatureStep[] = [];
  const lines = content.split("\n");
  let previousKeyword: StepKeyword | null = null;
  const docState: MultilineDocstringState = { active: false, delim: null };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    if (consumeMultilineDocstringLine(line, docState)) {
      continue;
    }

    if (line.match(/^\s*(Feature|Scenario|Scenario Outline|Background|Examples):/i)) {
      previousKeyword = null;
      docState.active = false;
      docState.delim = null;
      continue;
    }

    const stepInfo = parseStepLine(line, previousKeyword);
    if (stepInfo) {
      const keywordMatch = line.match(/^\s*(Given|When|Then|And|But)\s+/i);
      const character = keywordMatch ? keywordMatch[0].length : 0;

      steps.push({
        text: stepInfo.text,
        keyword: stepInfo.keyword,
        effectiveKeyword: stepInfo.effectiveKeyword,
        filePath,
        line: lineIndex,
        character,
      });

      if (stepInfo.effectiveKeyword) {
        previousKeyword = stepInfo.effectiveKeyword;
      }
    }
  }

  return steps;
}
