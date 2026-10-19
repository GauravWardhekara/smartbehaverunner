# Behave VSCode (Unified Behave Extension)

A comprehensive, high-performance Visual Studio Code extension for BDD testing with **[Behave](https://behave.readthedocs.io/)** in Python.

This extension unifies the capabilities of **[simplytest/behave-vsc](https://github.com/simplytest/behave-vsc)** and **[RemoYukoff/behave-runner](https://github.com/RemoYukoff/behave-runner)** into a single extension, eliminating duplicate runners while providing complete language and test runner tooling.

---

## Features

### 🧪 Native VS Code Test Explorer Integration
- **Instant Test Discovery**: High-speed TypeScript AST parsing indexes features, scenarios, scenario outlines, and example rows without spawning slow Python processes.
- **Hierarchical Test Tree**: View tests structured as `Feature -> Scenario Outline -> Examples` or `Feature -> Scenario -> Steps`.
- **Side-by-Side Failure Diffs**: Automatically matches failed assertions against configurable regexes (`behave.diffRegex`) to populate native VS Code expected vs. actual diff views.
- **Step-by-Step Status Updates**: Watch scenarios and individual steps update in real time (Passed, Failed, Skipped).

### ⚡ Execution & Debugging
- **Run & Debug Anywhere**: Launch runs from the Test Explorer, via editor CodeLens, or from the Command Palette.
- **In-Editor CodeLens**:
  - `$(play) Run` and `$(debug-alt) Debug` above Features and Scenarios.
  - `$(play) Run all` and `$(debug-alt) Debug all` above Scenario Outlines.
  - `$(play) Run` and `$(debug-alt) Debug` per example row.
- **Full Python Debugger Integration**: Seamlessly attaches `debugpy` to Behave with breakpoint support inside step definitions and environment hooks (`before_all`, `after_scenario`, etc.), supporting `justMyCode` filtering.
- **Clean Process Cancellation & Rerun**: Cancel running tests with a single click or keyboard shortcut, and rerun failed or last runs instantly.

### 📝 Gherkin & Step Language Tooling
- **Step Autocompletion**: Typing `Given `, `When `, `Then `, `And `, or `But ` triggers auto-complete for matching step definitions from your Python files, pre-filling arguments with `${1:placeholder}` snippets.
- **Instant Go to Definition**: Jump directly from a step in a `.feature` file to its `@given`, `@when`, `@then`, or `@step` definition in Python.
- **Find References & Usages**: Right-click any Python step function and select **Find All References** to locate every line across all `.feature` files where that step is used.
- **Document Formatting**: Format `.feature` files on save or manually (`Shift+Alt+F`) to align data tables and normalize indentation.
- **Semantic Tokens Syntax Highlighting**: Rich syntax coloring for tags (`@tag`), structural keywords (`Feature:`, `Scenario:`), step keywords (`Given`, `When`), placeholders (`<param>`), docstrings (`"""`), and data tables.
- **Diagnostics**: Automatically warns about undefined steps in `.feature` files before running tests.

### 📊 Live Run Webview Panel
- Monitor test execution in a dedicated bottom panel view (`Behave -> Live run`), showing live pass/fail counts, duration, and step outputs.

---

## Configuration Settings

All settings live under the `behave.*` namespace (with backwards-compatible aliases for `behaveRunner.*`):

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `behave.allowedFiles` | `string` | `**/*.feature` | Glob pattern matching allowed feature files. |
| `behave.featureFiles.patterns` | `string[]` | `["**/*.feature"]` | Glob patterns for Gherkin feature files. |
| `behave.stepDefinitions.patterns` | `string[]` | `["**/steps/**/*.py", "**/*_steps.py", "**/step_*.py", "**/steps.py"]` | Glob patterns for Python files containing step definitions. |
| `behave.autoDiscover` | `boolean` | `true` | Automatically discover all tests on startup. |
| `behave.codeLens` | `boolean` | `true` | Enable or disable in-editor CodeLens buttons. |
| `behave.arguments` | `string[]` | `["-f", "pretty"]` | Additional arguments passed to Behave CLI on test runs. |
| `behave.extraArgs` | `string[]` | `[]` | Extra arguments passed to Behave on both run and debug launches. |
| `behave.debug.justMyCode` | `boolean` | `true` | Only debug user code (skipping library internals) during debug runs. |
| `behave.livePanel.enabled` | `boolean` | `true` | Enable or disable the Live run webview panel. |
| `behave.diffRegex` | `string[]` | `["Expected: (?<expected>.*)[\\s\\S]*but: was (?<actual>.*)"]` | Regular expressions to match failed runs for expected vs. actual diff viewer. |

---

## Available Commands

- `behave.run`: Run the active feature or all discovered tests.
- `behave.debug`: Debug the active feature or scenario with `debugpy`.
- `behave.test`: Run tests via Test Explorer profile.
- `behave.discover`: Rescan workspace and rebuild test tree and step definitions index.
- `behave.analyze`: Load and parse the active feature file.
- `behave.cancelRun` (alias `behaveRunner.cancelRun`): Cancel active test run.
- `behave.rerunLastRun` (alias `behaveRunner.rerunLastRun`): Rerun the last executed test selection.
- `behave.showLiveRun` (alias `behaveRunner.showLiveRun`): Focus the Live run panel.
- `behave.editor.runFeature` / `debugFeature`: Run/Debug feature from editor.
- `behave.editor.runScenario` / `debugScenario`: Run/Debug scenario from editor.
- `behave.editor.runScenarioOutline` / `debugScenarioOutline`: Run/Debug scenario outline.

---

## License

MIT
