/**
 * Tracks multiline Gherkin docstrings (triple-quote or ``` opener at line start).
 * Aligns with {@link analyzeFeatureDocument} docstring handling in featureSemanticTokens.ts.
 */
export type MultilineDocstringState = {
  active: boolean;
  delim: '"""' | "```" | null;
};

/**
 * When `state.active`, treats the line as docstring body or closing delimiter.
 * Otherwise detects a docstring opener at line start (optional leading whitespace).
 *
 * @returns true if the line must not be parsed as Gherkin structure or steps.
 */
export function consumeMultilineDocstringLine(
  line: string,
  state: MultilineDocstringState
): boolean {
  if (state.active && state.delim) {
    if (line.includes(state.delim)) {
      state.active = false;
      state.delim = null;
    }
    return true;
  }

  const openDoc = line.match(/^\s*(\"\"\"|```)/);
  if (!openDoc || openDoc.index === undefined) {
    return false;
  }

  const delim = openDoc[1] as '"""' | "```";
  const delimStart = openDoc.index + openDoc[0].indexOf(delim);
  const afterOpen = line.slice(delimStart + delim.length);
  if (afterOpen.includes(delim)) {
    return true;
  }
  state.active = true;
  state.delim = delim;
  return true;
}
