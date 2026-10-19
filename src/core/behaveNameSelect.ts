/**
 * Behave `-n` / `--name` is a regular expression matched against scenario names.
 * Escape metacharacters so a Gherkin title selects exactly one scenario.
 */
export function escapeBehaveNameSelect(scenarioName: string): string {
  const trimmed = scenarioName.trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped}$`;
}
