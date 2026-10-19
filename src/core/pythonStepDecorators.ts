import { behavePatternToRegex } from "./stepMatcher";
import type { StepDefinition, StepKeyword } from "./types";

const DECORATOR_REGEX_DOUBLE =
  /^(\s*)@(given|when|then|step)\s*\(\s*(?:u?r?)?"((?:[^"\\]|\\.)*)"\s*\)/gim;

const DECORATOR_REGEX_SINGLE =
  /^(\s*)@(given|when|then|step)\s*\(\s*(?:u?r?)?'((?:[^'\\]|\\.)*)'\s*\)/gim;

const DECORATOR_REGEX_COMPILE_DOUBLE =
  /^(\s*)@(given|when|then|step)\s*\(\s*re\.compile\s*\(\s*r?"((?:[^"\\]|\\.)*)"/gim;

const DECORATOR_REGEX_COMPILE_SINGLE =
  /^(\s*)@(given|when|then|step)\s*\(\s*re\.compile\s*\(\s*r?'((?:[^'\\]|\\.)*)'/gim;

/** Defaults aligned with extension `package.json` contributes.configuration. */
export const DEFAULT_STEP_DEFINITION_PATTERNS = [
  "**/steps/**/*.py",
  "**/*_steps.py",
  "**/step_*.py",
  "**/steps.py",
];

export function tryParseBehaveStepDecoratorLine(
  line: string
): { keyword: string; pattern: string } | null {
  let match = matchDecorator(line, DECORATOR_REGEX_DOUBLE);
  if (!match) {
    match = matchDecorator(line, DECORATOR_REGEX_SINGLE);
  }
  if (!match) {
    match = matchDecorator(line, DECORATOR_REGEX_COMPILE_DOUBLE);
  }
  if (!match) {
    match = matchDecorator(line, DECORATOR_REGEX_COMPILE_SINGLE);
  }
  if (!match) {
    return null;
  }
  return {
    keyword: match.keyword.toLowerCase(),
    pattern: match.pattern,
  };
}

function matchDecorator(
  line: string,
  regex: RegExp
): { keyword: string; pattern: string; character: number } | null {
  regex.lastIndex = 0;
  const match = regex.exec(line);
  if (!match) {
    return null;
  }
  const indent = match[1];
  const keyword = match[2];
  const pattern = match[3];
  return {
    keyword,
    pattern,
    character: indent.length,
  };
}

/**
 * Parse Behave step definitions from a Python source string (decorators only).
 * Does not depend on VS Code; safe for LSP and tests.
 */
export function parseStepDefinitionsFromPython(
  filePath: string,
  content: string
): StepDefinition[] {
  const definitions: StepDefinition[] = [];
  const lines = content.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    let match = matchDecorator(line, DECORATOR_REGEX_DOUBLE);
    if (!match) {
      match = matchDecorator(line, DECORATOR_REGEX_SINGLE);
    }
    if (!match) {
      match = matchDecorator(line, DECORATOR_REGEX_COMPILE_DOUBLE);
    }
    if (!match) {
      match = matchDecorator(line, DECORATOR_REGEX_COMPILE_SINGLE);
    }

    if (match) {
      const { keyword, pattern, character } = match;
      try {
        const regex = behavePatternToRegex(pattern);
        definitions.push({
          keyword: keyword.toLowerCase() as StepKeyword,
          pattern,
          regex,
          filePath,
          line: lineIndex,
          character,
        });
      } catch {
        console.warn(
          `Invalid step pattern in ${filePath}:${lineIndex + 1}: ${pattern}`
        );
      }
    }
  }

  return definitions;
}

/**
 * Heuristic: whether a path plausibly matches configured step-definition globs
 * (used to filter file watcher events without running full glob each time).
 */
export function pathMatchesStepDefinitionPatterns(
  filePath: string,
  patterns: string[]
): boolean {
  const lowerPath = filePath.toLowerCase().replace(/\\/g, "/");

  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase();

    if (lowerPattern.includes("**/steps/**")) {
      if (lowerPath.includes("/steps/")) {
        return true;
      }
    } else if (lowerPattern.endsWith("_steps.py")) {
      if (lowerPath.endsWith("_steps.py")) {
        return true;
      }
    } else if (lowerPattern.includes("step_")) {
      if (lowerPath.includes("step_") && lowerPath.endsWith(".py")) {
        return true;
      }
    } else if (lowerPattern.endsWith("steps.py")) {
      if (lowerPath.endsWith("steps.py")) {
        return true;
      }
    } else if (lowerPattern.endsWith(".py")) {
      if (lowerPath.endsWith(".py")) {
        return true;
      }
    }
  }

  return false;
}
