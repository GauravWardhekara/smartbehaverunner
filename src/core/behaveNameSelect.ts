/**
 * Behave `-n` / `--name` is a regular expression matched against scenario names.
 * Escape metacharacters so a Gherkin title selects exactly one scenario.
 */
export function escapeBehaveNameSelect(scenarioName: string): string {
  return scenarioName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
