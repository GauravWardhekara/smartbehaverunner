# Smart Behave Runner

[![Visual Studio Marketplace](https://img.shields.io/badge/VS%20Code-Smart%20Behave%20Runner-blue.svg)](https://marketplace.visualstudio.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python: Behave](https://img.shields.io/badge/Python-Behave%20BDD-brightgreen.svg)](https://behave.readthedocs.io/)

A unified, high-performance Visual Studio Code extension for Behavior-Driven Development (BDD) with **[Behave](https://behave.readthedocs.io/)** in Python.

**Smart Behave Runner** merges and enhances the capabilities of two popular VS Code extensions:
- **[simplytest/behave-vsc](https://github.com/simplytest/behave-vsc)** (by SimplyTest / Curve)
- **[RemoYukoff/behave-runner](https://github.com/RemoYukoff/behave-runner)** (by Remo Yukoff)

By eliminating duplicated execution engines and unifying language tools with test running capabilities, **Smart Behave Runner** provides an all-in-one experience: instant AST-based test discovery, native Test Explorer with assertion diffs, interactive configuration screen, in-editor CodeLens, seamless `debugpy` debugging, step autocompletion, Go to Definition, Find References, formatting, and a real-time live run dashboard.

---

## 🌟 Acknowledgments & Credits

We extend sincere gratitude to the original creators whose foundational work made this unified extension possible:
- **SimplyTest & Curve** for creating [behave-vsc](https://github.com/simplytest/behave-vsc), pioneering pure TypeScript Gherkin AST parsing, step autocompletion, Go to Definition, semantic syntax highlighting, and native VS Code Test Explorer integration.
- **Remo Yukoff** for developing [behave-runner](https://github.com/RemoYukoff/behave-runner), introducing live NDJSON streaming execution, granular scenario-level debugging, the Live Run webview panel, and interactive test tree workflows.

This project is licensed under the **MIT License**, honoring both original projects and their open-source contributions.

---

## 🚀 Key Features

### ⚙️ Interactive Configuration Screen & Diagnostics
Open at any time via **`Smart Behave: Open Configuration Screen`** (`smartBehave.openConfiguration`):
- **Live Python Interpreter Detection**: Automatically probes the active Python runtime from the Microsoft Python extension or environment path.
- **Behave CLI Probe**: Validates your installed Behave version and CLI capabilities (such as `--no-capture` stdout support).
- **Index Statistics**: Shows real-time counts of indexed Python step definitions and Gherkin feature steps with a one-click **Rebuild Index** button.
- **Form-Based Settings Management**: Easily adjust feature file patterns, step definition paths, CLI arguments, assertion diff regular expressions, and debugging preferences.
- **Dual Target Saving**: Save configuration changes directly to your **Workspace Settings** (`.vscode/settings.json`) or **User Settings** (`global`).
- **Quick Links**: Direct button to open standard VS Code Settings UI filtered to Smart Behave settings.

---

### 🧪 Native VS Code Test Explorer (`vscode.TestController`)
- **Instant Zero-Latency Discovery**: Pure TypeScript AST parser discovers features, scenarios, scenario outlines, and example tables instantly—without waiting for slow Python subprocesses.
- **Full Hierarchy**: Tests are structured cleanly:
  - `Feature` &rarr; `Scenario` &rarr; `Steps`
  - `Feature` &rarr; `Scenario Outline` &rarr; `Examples` table &rarr; `Row`
- **Side-by-Side Expected vs. Actual Diffs**: Failed assertions matching `smartBehave.diffRegex` populate native VS Code failure diffs for immediate debugging.
- **Live Status Streaming**: Steps and scenarios update dynamically to *Running*, *Passed*, *Failed*, or *Skipped* as tests execute.

---

### ⚡ Execution & Debugging (`debugpy`)
- **Run & Debug Anywhere**: Launch runs directly from the Test Explorer tree, in-editor CodeLens, or the Command Palette.
- **In-Editor CodeLens**:
  - `▶ Run` and `🐞 Debug` above `Feature` and `Scenario` headers.
  - `▶ Run all` and `🐞 Debug all` above `Scenario Outline` headers.
  - `▶ Run` and `🐞 Debug` per example table row.
- **Full Python Debugger Integration**: Seamlessly attaches `debugpy` to Behave with breakpoint support inside step definitions, before/after scenario hooks, and environment fixtures.
- **`justMyCode` Filtering**: Set `smartBehave.debug.justMyCode` to `true` to step cleanly through your own code while skipping internal framework libraries.
- **Cancellation & Rerun**: Cancel executing tests instantly (`Smart Behave: Cancel Run`) and rerun the previous test suite with one click (`Smart Behave: Rerun Last Run`).

---

### 📝 Gherkin & Python Language Tooling
- **Step Autocompletion**: Typing `Given `, `When `, `Then `, `And `, or `But ` provides suggestions matching step definitions from your Python files, generating tab stops for parameters (`${1:param}`).
- **Go to Definition (F12)**: Jump from any step in a `.feature` file directly to its `@given`, `@when`, `@then`, or `@step` Python decorator and implementation.
- **Find References (Shift+F12)**: Right-click any Python step function and select **Find All References** to inspect every `.feature` file and line number where that step is executed.
- **Document & Range Formatting**: Format `.feature` files manually (`Shift+Alt+F`) or automatically on save to align table pipes (`|`) and normalize indentation.
- **Semantic Syntax Highlighting**: Rich token coloring for tags (`@tag`), structural keywords (`Feature:`, `Scenario:`), step keywords (`Given`, `When`), placeholders (`<param>`), docstrings (`"""`), and data tables.
- **Undefined Step Diagnostics**: Underlines unknown steps in `.feature` files with informative warnings before tests are executed.

---

### 📊 Live Run Panel
- Dedicated bottom panel tab (**Smart Behave &rarr; Live Run**) displaying real-time test progress, streaming execution logs, passed/failed counters, and duration timers.

---

## 🛠️ Configuration Settings

Settings can be customized via the interactive **Configuration Screen** or directly in your `.vscode/settings.json`.

Primary settings use the `smartBehave.*` namespace. Settings from `behave.*` and `behaveRunner.*` remain fully supported as backward-compatible aliases:

| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `smartBehave.allowedFiles` | `string` | `**/*.feature` | Glob pattern matching allowed feature files. |
| `smartBehave.featureFiles.patterns` | `string[]` | `["**/*.feature"]` | Glob patterns for Gherkin feature files. |
| `smartBehave.stepDefinitions.patterns` | `string[]` | `["**/steps/**/*.py", "**/*_steps.py", "**/step_*.py", "**/steps.py"]` | Glob patterns for Python files containing step definitions. |
| `smartBehave.autoDiscover` | `boolean` | `true` | Automatically discover and index all tests on workspace startup. |
| `smartBehave.codeLens` | `boolean` | `true` | Enable or disable in-editor CodeLens (Run/Debug buttons). |
| `smartBehave.arguments` | `string[]` | `["-f", "pretty"]` | Additional command-line arguments to pass to the Behave CLI on test runs. |
| `smartBehave.extraArgs` | `string[]` | `[]` | Extra arguments passed to Behave on both run and debug launches (e.g. `["--tags=@wip"]`). |
| `smartBehave.debug.justMyCode` | `boolean` | `true` | Only debug user code (skipping third-party libraries) during debug mode. |
| `smartBehave.livePanel.enabled` | `boolean` | `true` | Enable or disable the Live Run webview panel. |
| `smartBehave.diffRegex` | `string[]` | `["Expected: (?<expected>.*)[\\s\\S]*but: was (?<actual>.*)"]` | Regular expressions to match failed assertions for side-by-side expected vs. actual diffs. |

---

## ⌨️ Commands

Access these commands from the Command Palette (`Ctrl+Shift+P` on Windows/Linux, `Cmd+Shift+P` on macOS):

| Command ID | Title | Description |
| :--- | :--- | :--- |
| `smartBehave.openConfiguration` | **Smart Behave: Open Configuration Screen** | Opens the interactive visual settings and diagnostics panel. |
| `smartBehave.run` | **Smart Behave: Run** | Run the active feature file or all discovered tests. |
| `smartBehave.debug` | **Smart Behave: Debug** | Debug the active feature file or scenario using `debugpy`. |
| `smartBehave.cancelRun` | **Smart Behave: Cancel Run** | Cancel the currently active test execution. |
| `smartBehave.rerunLastRun` | **Smart Behave: Rerun Last Run** | Rerun the last executed test selection. |
| `smartBehave.discover` | **Smart Behave: Re-index Features and Steps** | Rebuild the test tree, Python step definitions, and feature indices. |
| `smartBehave.showLiveRun` | **Smart Behave: Show Live Run Panel** | Focus and reveal the Live Run webview panel. |

*(All previous command IDs under `behave.*` and `behaveRunner.*` are also registered as aliases.)*

---

## 📦 Requirements

- **VS Code**: version `1.85.0` or higher.
- **Python**: version `3.8+` with the [Microsoft Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python).
- **Behave**: `pip install behave` (and optional `debugpy` for debugging).

---

## 📄 License

This extension is licensed under the [MIT License](LICENSE).

Copyright (c) 2025-2026 Smart Behave Runner Contributors.  
Portions Copyright (c) 2025 Curve & SimplyTest (`behave-vsc`).  
Portions Copyright (c) Remo Yukoff (`behave-runner`).
