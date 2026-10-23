import { StepDefinition, StepKeyword } from "./types";

/**
 * Behave type placeholders and their regex equivalents
 * See: https://behave.readthedocs.io/en/stable/parse.html
 */
/**
 * Behave type placeholders and their regex equivalents
 * Supports standard Python parse types, Behave extensions, and Cucumber expressions.
 * See: https://behave.readthedocs.io/en/stable/parse.html
 * See: https://cucumber.io/docs/cucumber/cucumber-expressions/
 */
export const BEHAVE_TYPE_PATTERNS: Record<string, string> = {
  // Behave / Python parse built-in format types
  d: "-?\\d+", // integer (base 10)
  f: "-?\\d*(?:\\.\\d+)?", // float
  g: "-?\\d*(?:\\.\\d+)?(?:[eE][-+]?\\d+)?", // general number (float or exp)
  w: "\\w+", // letters, numbers and underscore
  W: "\\W+", // non-word
  s: "\\s+", // whitespace
  S: "\\S+", // non-whitespace
  n: "(?:0[bB][01]+|0[oO][0-7]+|0[xX][0-9a-fA-F]+|-?\\d+)", // base-prefixed number
  b: "-?[01]+", // binary
  o: "-?[0-7]+", // octal
  x: "-?[0-9a-fA-F]+", // hexadecimal (lower)
  X: "-?[0-9a-fA-F]+", // hexadecimal (upper)
  th: "\\d{1,2}:\\d{2}(?::\\d{2})?", // time (hh:mm[:ss])
  ti: "\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?)?", // ISO 8601 date/time
  te: "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \\d{4} \\d{2}:\\d{2}:\\d{2}", // RFC 2822
  tc: "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \\d]\\d \\d{2}:\\d{2}:\\d{2} \\d{4}", // ctime

  // Cucumber expression types
  int: "-?\\d+",
  float: "-?\\d*(?:\\.\\d+)?",
  double: "-?\\d*(?:\\.\\d+)?",
  bigdecimal: "-?\\d*(?:\\.\\d+)?",
  biginteger: "-?\\d+",
  byte: "-?\\d+",
  short: "-?\\d+",
  long: "-?\\d+",
  word: "[^\\s]+",
  string: "(?:\"[^\"]*\"|'[^']*')",
  stringInDoubleQuotes: "\"[^\"]*\"",
};

/**
 * Default pattern for untyped placeholders like {name}
 */
const DEFAULT_PLACEHOLDER_PATTERN = ".+";

/**
 * Pattern to match Scenario Outline placeholders like <name>
 */
const OUTLINE_PLACEHOLDER_PATTERN = "<[^>]+>";

/**
 * Expands alternatives in a step pattern (like `a/b` or `(a|b)`) into individual variants.
 */
export function getStepTextInvariants(pattern: string): string[] {
  // Handle alternatives like (a|b) or (?:a|b)
  const groupMatch = pattern.match(/\((?:\?:)?([^()|]+(?:\|[^()|]+)+)\)/);
  if (groupMatch && groupMatch[1]) {
    const fullGroup = groupMatch[0];
    const options = groupMatch[1].split("|");
    const results: string[] = [];
    for (const opt of options) {
      const replaced = pattern.replace(fullGroup, opt);
      results.push(...getStepTextInvariants(replaced));
    }
    return results;
  }

  // Handle slash alternatives like red/blue/green
  const slashMatch = pattern.match(/\b([a-zA-Z0-9_]+)(?:\/([a-zA-Z0-9_]+))+\b/);
  if (slashMatch) {
    const fullSlash = slashMatch[0];
    const options = fullSlash.split("/");
    const results: string[] = [];
    for (const opt of options) {
      const replaced = pattern.replace(fullSlash, opt);
      results.push(...getStepTextInvariants(replaced));
    }
    return results;
  }

  return [pattern];
}

function buildBehavePatternRegexBody(
  pattern: string,
  capturePlaceholders: boolean
): string {
  // 1. Pre-process word alternatives like red/blue -> (?:red/blue|red|blue)
  // Preserves literal slash phrases like date/time while also supporting individual alternatives
  let processed = pattern.replace(
    /\b([a-zA-Z0-9_]+)(?:\/([a-zA-Z0-9_]+))+\b/g,
    (match) => {
      const parts = match.split("/");
      return `(?:${match}|${parts.join("|")})`;
    }
  );

  // 2. Pre-process optional text like apple(s) or (a ) -> (?:s)? or (?:a )?
  processed = processed.replace(
    /\(([a-zA-Z\s]+)\)\??/g,
    "(?:$1)?"
  );

  // 3. Tokenize regex groups and placeholders
  const tokens: { raw: string; isQuoted?: boolean }[] = [];

  // Match quoted placeholders: '{name}', "{name}", \'{name}\', \"{name}\"
  let tokenized = processed.replace(
    /(?:\\?(['"]))\{([^{}:]*)(?::([^{}]+))?\}\1/g,
    (m) => {
      tokens.push({ raw: m, isQuoted: true });
      return `__TOKEN_${tokens.length - 1}__`;
    }
  );

  // Match unquoted placeholders or (?:...) groups
  tokenized = tokenized.replace(
    /(?:\(\?:[^\)]+\)\??|\{[^{}]*\})/g,
    (m) => {
      tokens.push({ raw: m, isQuoted: false });
      return `__TOKEN_${tokens.length - 1}__`;
    }
  );

  let regexStr = tokenized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let captureIndex = 0;
  regexStr = regexStr.replace(/([ \t]*)__TOKEN_(\d+)__/g, (_, ws, idxStr) => {
    const token = tokens[Number(idxStr)];
    if (token.raw.startsWith("(?:")) {
      return (ws || "") + token.raw; // Preserved alternative/optional regex group
    }

    const m = token.raw.match(/\{([^{}:]*)(?::([^{}]+))?\}/);
    if (!m) {
      return (ws || "") + "\\{\\}";
    }
    const namePart = (m[1] ?? "").trim();
    let typePart = (m[2] ?? "").trim();
    let cardinality = "";
    if (typePart && /[?*+]$/.test(typePart)) {
      cardinality = typePart.slice(-1);
      typePart = typePart.slice(0, -1);
    }

    let resolvedBase: string | undefined;
    if (typePart && BEHAVE_TYPE_PATTERNS[typePart]) {
      resolvedBase = BEHAVE_TYPE_PATTERNS[typePart];
    } else if (!typePart && namePart && BEHAVE_TYPE_PATTERNS[namePart]) {
      // Cucumber expression style: e.g. {int}, {float}, {string}, {word}
      resolvedBase = BEHAVE_TYPE_PATTERNS[namePart];
    } else if (typePart) {
      // Unknown custom type e.g. {user:CustomType} -> match non-whitespace
      resolvedBase = "[^\\s]+";
    }

    const basePattern = resolvedBase || DEFAULT_PLACEHOLDER_PATTERN;
    let inner: string;

    const prefixWs = cardinality === "?" ? "" : (ws || "");

    if (cardinality === "?") {
      const optGroup = `(?:${basePattern}|${OUTLINE_PLACEHOLDER_PATTERN})`;
      inner = ws ? `(?:${ws}${optGroup})?` : `(?:${optGroup})?`;
    } else if (cardinality === "*") {
      const repGroup = `(?:${basePattern}|${OUTLINE_PLACEHOLDER_PATTERN})`;
      inner = `(?:${repGroup}(?:\\s*,?\\s*${repGroup})*)?`;
    } else if (cardinality === "+") {
      const repGroup = `(?:${basePattern}|${OUTLINE_PLACEHOLDER_PATTERN})`;
      inner = `(${repGroup}(?:\\s*,?\\s*${repGroup})*)`;
    } else {
      inner = `(?:${basePattern}|${OUTLINE_PLACEHOLDER_PATTERN})`;
    }

    if (token.isQuoted) {
      if (capturePlaceholders) {
        const g = `p${captureIndex++}`;
        return prefixWs + `['"]?(?<${g}>${inner})['"]?`;
      }
      return prefixWs + `['"]?${inner}['"]?`;
    }

    if (capturePlaceholders) {
      const g = `p${captureIndex++}`;
      return prefixWs + `(?<${g}>${inner})`;
    }
    return prefixWs + inner;
  });

  return regexStr;
}

/**
 * Converts a Behave pattern string to a RegExp.
 *
 * Behave supports patterns like:
 * - {name} -> matches any non-empty string
 * - {name:d} -> matches integers
 * - {name:f} -> matches floats
 * - {name:w} -> matches words
 *
 * The generated regex also accepts Scenario Outline placeholders (<name>)
 * in place of any typed value.
 *
 * @param pattern The Behave pattern string (e.g., "the number is {n:d}")
 * @returns A RegExp that matches step text (including Scenario Outline placeholders)
 */
export function behavePatternToRegex(pattern: string): RegExp {
  return new RegExp(`^${buildBehavePatternRegexBody(pattern, false)}$`, "i");
}

/**
 * Same as {@link behavePatternToRegex} but each `{placeholder}` becomes a named capture
 * (`p0`, `p1`, …) so match indices can be mapped to `.feature` step text for highlighting.
 * Uses the `d` flag (requires ES2022 / modern Node).
 */
export function behavePatternToCaptureRegex(pattern: string): RegExp {
  return new RegExp(`^${buildBehavePatternRegexBody(pattern, true)}$`, "id");
}

/**
 * For a concrete step line body and a Behave `@step` pattern string, returns UTF-16 ranges
 * (relative to {@link String#trim trim}(stepText)) for each `{capture}` that matched.
 * Used to paint placeholder color only on values bound to pattern captures — not literals
 * like quotes or Fixed words in the pattern.
 */
export function capturePlaceholderRangesFromBehavePattern(
  stepText: string,
  pattern: string
): { start: number; end: number }[] | null {
  let re: RegExp;
  try {
    re = behavePatternToCaptureRegex(pattern);
  } catch {
    return null;
  }
  const trimmed = stepText.trim();
  const m = re.exec(trimmed);
  const groups = m?.indices?.groups;
  if (!m || !groups) {
    return null;
  }
  const ranges: { start: number; end: number }[] = [];
  for (const key of Object.keys(groups)) {
    const span = groups[key];
    if (
      span &&
      typeof span[0] === "number" &&
      typeof span[1] === "number" &&
      span[1] > span[0]
    ) {
      ranges.push({ start: span[0], end: span[1] });
    }
  }
  if (ranges.length === 0) {
    return null;
  }
  ranges.sort((a, b) =>
    a.start !== b.start ? a.start - b.start : b.end - a.end
  );
  return ranges;
}

/**
 * Checks if a step text matches a step definition.
 *
 * @param stepText The step text from the .feature file (without keyword)
 * @param definition The step definition to match against
 * @returns true if the step text matches the definition's pattern
 */
export function matchesStepDefinition(
  stepText: string,
  definition: StepDefinition
): boolean {
  return definition.regex.test(stepText.trim());
}

/**
 * Finds all matching step definitions for a given step text.
 * Supports Scenario Outline placeholders like <name> automatically
 * (the regex already accepts them as alternatives).
 *
 * @param stepText The step text from the .feature file (without keyword)
 * @param keyword The effective keyword (given, when, then) or null for any
 * @param definitions All available step definitions
 * @returns Array of matching step definitions
 */
export function findMatchingDefinitions(
  stepText: string,
  keyword: StepKeyword | null,
  definitions: StepDefinition[]
): StepDefinition[] {
  const trimmedText = stepText.trim();

  return definitions.filter((def) => {
    // Filter by keyword first (fast operation)
    // @step decorator matches any keyword
    if (keyword && def.keyword !== "step" && def.keyword !== keyword) {
      return false;
    }

    // Single regex match - works for both normal steps and Scenario Outline
    // because the regex accepts <placeholder> as an alternative to typed values
    return def.regex.test(trimmedText);
  });
}

/**
 * Extracts step information from a line in a .feature file.
 *
 * @param line The line text
 * @param previousKeyword The keyword from the previous step (for And/But resolution)
 * @returns StepInfo if the line is a step, null otherwise
 */
/**
 * Parse a feature line as an in-progress step (e.g. for LSP completion).
 * Allows empty step text after the keyword; uses the same keyword list as {@link parseStepLine}.
 */
export function parseStepLinePrefixForCompletion(
  line: string,
  lines: string[],
  cursorLine: number
): {
  keyword: string;
  partialText: string;
  /** 0-based column in `line` where step text (completion prefix) begins. */
  keywordEnd: number;
  effectiveKeyword: StepKeyword | null;
} | null {
  const match = line.match(/^\s*(Given|When|Then|And|But|\*)\s*(.*)$/i);
  if (!match) {
    return null;
  }
  const fullMatch = match[0];
  const keyword = match[1];
  const partialText = match[2] ?? "";
  const keywordEnd = fullMatch.length - partialText.length;
  const lower = keyword.toLowerCase();
  let effectiveKeyword: StepKeyword | null = null;
  if (lower === "given" || lower === "when" || lower === "then") {
    effectiveKeyword = lower as StepKeyword;
  } else if (lower === "and" || lower === "but" || lower === "*") {
    effectiveKeyword = resolveEffectiveKeyword(lines, cursorLine);
  }
  return { keyword, partialText, keywordEnd, effectiveKeyword };
}

export function parseStepLine(
  line: string,
  previousKeyword: StepKeyword | null = null
): { keyword: string; text: string; effectiveKeyword: StepKeyword | null } | null {
  const cleanLine = line.replace(/\r$/, "");
  const stepMatch = cleanLine.match(/^\s*(Given|When|Then|And|But|\*)\s+(.+)$/i);

  if (!stepMatch) {
    return null;
  }

  const keyword = stepMatch[1];
  const text = stepMatch[2];

  let effectiveKeyword: StepKeyword | null = null;

  switch (keyword.toLowerCase()) {
    case "given":
      effectiveKeyword = "given";
      break;
    case "when":
      effectiveKeyword = "when";
      break;
    case "then":
      effectiveKeyword = "then";
      break;
    case "and":
    case "but":
    case "*":
      // Inherit from previous step
      effectiveKeyword = previousKeyword;
      break;
  }

  return { keyword, text, effectiveKeyword };
}

/**
 * Determines the effective keyword for a step at a given line,
 * by scanning backwards through the document to find the parent keyword.
 *
 * @param lines Array of document lines
 * @param targetLine The line number of the step (0-based)
 * @returns The effective keyword or null
 */
export function resolveEffectiveKeyword(
  lines: string[],
  targetLine: number
): StepKeyword | null {
  // First check if the current line has a direct keyword (Given/When/Then)
  const currentLine = lines[targetLine];
  const directMatch = currentLine.match(/^\s*(Given|When|Then)\s+/i);
  if (directMatch) {
    return directMatch[1].toLowerCase() as StepKeyword;
  }

  // If current line is And/But, search backwards for parent keyword
  const isAndBut = currentLine.match(/^\s*(And|But|\*)\s+/i);
  if (!isAndBut) {
    // Not a step line
    return null;
  }

  // Search backwards from the previous line
  for (let i = targetLine - 1; i >= 0; i--) {
    const line = lines[i];
    
    // Found a direct keyword - this is the parent
    const parentMatch = line.match(/^\s*(Given|When|Then)\s+/i);
    if (parentMatch) {
      return parentMatch[1].toLowerCase() as StepKeyword;
    }

    // Skip And/But lines, continue searching
    const andButMatch = line.match(/^\s*(And|But|\*)\s+/i);
    if (andButMatch) {
      continue;
    }

    // If we hit a non-step line (like Scenario:, Feature:, empty line, etc.)
    // we stop searching - no parent keyword found
    const isEmptyOrComment = line.match(/^\s*(#.*)?$/);
    if (!isEmptyOrComment) {
      // Hit a structural line like Scenario:, break the search
      break;
    }
  }

  return null;
}
