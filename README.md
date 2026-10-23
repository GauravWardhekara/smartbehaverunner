# Smart Cucumber-Behave

[![Visual Studio Marketplace](https://img.shields.io/badge/VS%20Code-Smart%20Cucumber--Behave-blue.svg)](https://marketplace.visualstudio.com)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-Smart%20Cucumber--Behave-purple.svg)](https://open-vsx.org)
[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://github.com/GauravWardhekara/smart-cucumber-behave/releases)
[![Issues](https://img.shields.io/github/issues/GauravWardhekara/smart-cucumber-behave.svg)](https://github.com/GauravWardhekara/smart-cucumber-behave/issues)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cucumber](https://img.shields.io/badge/Cucumber-Language%20Server-green.svg)](https://cucumber.io/)
[![Python: Behave](https://img.shields.io/badge/Python-Behave%20BDD-brightgreen.svg)](https://behave.readthedocs.io/)
[![Allure Report](https://img.shields.io/badge/Allure-Report%20Supported-orange.svg)](https://allurereport.org/)

A complete, high-performance Visual Studio Code extension integrating the **official [Cucumber Language Server](https://github.com/cucumber/vscode)** with the advanced **Smart Behave Runner** test execution engine and fine-grained **Custom Gherkin Formatter**.

---

## 🌟 What is Smart Cucumber-Behave?

**Smart Cucumber-Behave** combines two complete BDD toolsets into a single extension:

1. **Official Cucumber Language Server (`@cucumber/language-server`)**:
   - Backed by tree-sitter WebAssembly (WASM) grammars.
   - Cross-language step definition indexing (`cucumber.glue`) supporting **Python**, **TypeScript/JavaScript**, **Java**, **C#**, **Ruby**, **PHP**, **Rust**, and **Go**.
   - Full support for **Cucumber Expressions** and Regular Expressions.
   - Support for **Custom Parameter Types** (`cucumber.parameterTypes`).
   - Autocomplete for Given/When/Then steps across all glue languages.
   - Go to Step Definition (F12) across all glue languages.
   - Diagnostics for undefined steps and Gherkin syntax errors.
   - Quick Fix action to generate step definition snippets.
   - Document structure and semantic tokens.

2. **Smart Behave Test Runner & Execution Platform**:
   - **Activity Bar & Primary Side Bar View**: Dedicated **`Cucumber-Behave`** view on the Activity Bar, divided into 3 dedicated workflow tabs:
     - 🔍 **Discovery Tab**: Real-time search of feature files in `features/` and workspace, tree view of Features, Scenarios, and Steps, stored default configuration & capability (`caps_file`) selection, and stop controls.
     - ⚡ **Execution Tab**: Current tests under execution, live step progression, real-time streaming ANSI terminal logs, and immediate stop controls.
     - 📊 **Results Tab**: Completed test runs sorted by Feature, Scenario, and Date, expandable failure tracebacks, and global **Allure Report** generation and viewer.
   - **Native VS Code Test Explorer (`TestController`)**: Instant zero-latency discovery of Features, Scenarios, and Examples with pass/fail hierarchy propagation (when a scenario fails, the scenario and whole feature are marked failed; when all pass, both pass).
   - **Multi-Language Interactive Configuration Screen**: Multi-runtime diagnostic prober (Python, Node.js, Java, .NET, Ruby, PHP, Rust, Go), live Gherkin formatter preview, Cucumber settings, and Behave test runner settings.
   - **In-Editor CodeLens**: `▶ Run` and `🐞 Debug` buttons directly above Features, Scenarios, and Example rows.
   - **Full Debugging (`debugpy`)**: Breakpoint debugging inside step functions, hooks, and environment fixtures with `justMyCode` stepping.

3. **Custom Gherkin Keyword Formatter**:
   - Fully customizable, keyword-specific indentation levels for **Feature, Scenario, Background, Given, When, Then, And, But**.
   - Default **Stepped Ladder** preset: Feature has 0 tabs, Scenario has 1 tab, Given has 2 tabs, When has 2 tabs, Then has 3 tabs, And has 4 tabs, But has 4 tabs.
   - Formats via standard VS Code document formatting (`Shift+Alt+F`), format-on-save, and on-type table pipe formatting (`|`).

---

## 🚀 Key Features

### 📐 Custom Gherkin Formatter
Customize exact indentation levels (tabs or spaces) per Gherkin keyword:

| Keyword | Default Tabs | Description |
| :--- | :---: | :--- |
| **`Feature:`** | `0` | Root feature header has no tab |
| **`Scenario:`** / **`Scenario Outline:`** | `1` | One tab after Feature |
| **`Background:`** | `1` | Feature background setup block |
| **`Rule:`** | `1` | Business rule header |
| **`Given`** | `2` | Initial context step (one more tab after Scenario) |
| **`When`** | `2` | Action step |
| **`Then`** | `3` | Outcome step (one more tab after Given) |
| **`And`** | `4` | Subsequent step (one more tab after Then) |
| **`But`** | `4` | Negative assertion step |
| **`Examples:`** | `2` | Scenario Outline examples header |
| **Tables (`\| cell \|`)** | Auto | Neatly padded and aligned pipes under parent step/examples |
| **Docstrings (`"""`)** | Auto | Aligned under parent step with automated JSON formatting |

```gherkin
Feature: User Authentication & Dashboard
	Background: Database initialization
		Given database connection is open

	Scenario: Successful login with multi-factor authentication
		Given user is on login page
		When user enters valid credentials
			Then user receives one-time passcode
				And security dashboard is displayed
				But lockout warning is not triggered
```

* **Interactive Presets**: Switch instantly in the Configuration Screen between **Stepped Ladder (0, 1, 2, 2, 3, 4, 4)**, **Standard BDD (0, 1, 2, 2, 2, 2, 2)**, or **Strict Cascade**.
* **Indentation Character**: Choose `"tab"` (force `\t`), `"spaces"`, or `"auto"` (respecting editor tab settings).
* **Relative And/But**: Option to dynamically indent `And`/`But` +1 tab after the preceding step.

---

### 🌐 Multi-Language Interactive Configuration Screen
Open anytime via **`Smart Behave: Open Configuration Screen`** (`smartBehave.openConfiguration`):
- **Multi-Language Runtime Probe**: One-click probe detecting active versions for **Python**, **JavaScript/TypeScript (Node.js)**, **Java (JDK)**, **C# (.NET)**, **Ruby**, **PHP**, **Rust**, and **Go**.
- **Interactive Formatter Controls**: Slider/number inputs with an **instant live Gherkin preview box** updating in real-time as you tweak tab values.
- **Cucumber Global Settings**: Direct editing of `cucumber.features`, `cucumber.glue`, and `cucumber.parameterTypes`.
- **Python Behave Runner Settings**: Probes Behave CLI version, manages CLI arguments, config directory, and capability files (`caps_file`).
- **Dual Target Saving**: Save configuration changes directly to your **Workspace Settings** (`.vscode/settings.json`) or **User Settings** (`global`).

---

### 🥒 Official Cucumber Language Server Integration
- **Multilingual Step Definitions**: Index step implementations in Python (`*.py`), JavaScript/TypeScript (`*.js`, `*.ts`, `*.jsx`, `*.tsx`), Java (`*.java`), C# (`*.cs`), Ruby (`*.rb`), PHP (`*.php`), Rust (`*.rs`), and Go (`*_test.go`).
- **Cucumber Expressions**: Native matching for `{int}`, `{float}`, `{word}`, `{string}`, `{anonymous}`, and custom parameter types.
- **Cross-language Autocomplete & Navigation**: Jump between `.feature` files and glue source code with Go to Definition (F12).

---

### 🧪 Native VS Code Test Explorer (`vscode.TestController`)
- **Instant Discovery**: Fast pure-TypeScript AST parsing discovers features, scenarios, scenario outlines, and example tables instantly.
- **Pass/Fail Propagation**:
  - If any scenario fails, both the scenario and the parent Feature are marked as failed.
  - If all scenarios pass, both the scenarios and the parent Feature are marked as passed.
- **Side-by-Side Diffs**: Failed assertions matching `smartBehave.diffRegex` display expected vs. actual side-by-side in VS Code's native diff viewer.

---

### ⚡ Cucumber-Behave Activity Bar & 3-Tab Primary Side Bar
Located directly on the VS Code / Antigravity IDE **Activity Bar** under the **`Cucumber-Behave`** icon, dividing test operations into three clean, dedicated tabs:

#### 1. 🔍 Discovery Tab (Test Discovery)
- **Search Features**: Instant dynamic search filtering across `.feature` files in the `features/` directory and across workspace folders.
- **Tree View**: Hierarchical tree with **Feature** at top, **Scenario** under it, and clickable **Steps** (`Given`, `When`, `Then`, `And`, `But`).
- **Click to Inspect Steps**: Click any scenario to toggle and view its test steps. Click any step to open the `.feature` file directly at that step.
- **Run with Defaults or Caps File**: Launch test runs using your stored default configuration or choose any detected capability file (`caps_file` like `android_caps_v1.json`, `ios_caps_v5.json`) from the toolbar dropdown.
- **Stop In-Progress Runs**: Prominent **Stop** button appears if an execution is already in progress, letting you cancel tests safely.
- **Go to Execution Tab**: Instant one-click shortcut to switch to live execution monitoring.

#### 2. ⚡ Execution Tab (Current Tests & Realtime Logs)
- **Current Tests Under Execution**: Live progress tree showing the active Feature, Scenarios, and Steps with spinning indicators, green checkmarks, and red failure badges.
- **Real-Time Streaming Terminal Logs**: High-performance streaming console displaying Behave terminal output as tests execute.
- **Console Find Bar**: Quick search inside streaming logs with match counts and next/previous navigation.
- **Stop Execution**: Immediate stop button to terminate lingering test processes.
- **Rerun & Clear**: Quick rerun of the last test selection and log clearing.

#### 3. 📊 Results Tab (Completed Tests & Allure Reports)
- **Completed Tests List**: Full history of executed test runs with status indicators (Passed, Failed, Cancelled), duration, and timestamps.
- **Flexible Sorting**: Sort completed tests by **Date (Newest/Oldest First)**, **Feature Name**, or **Scenario Name**.
- **Status Filter & Search**: Filter by Passed/Failed and instant search.
- **Expandable Failure Details**: For failed tests, inspect the exact failure step, error message, and traceback. Click to jump to the scenario in code.
- **Global Allure Report Generation & Viewer**:
  - **Generate Allure Report**: Generates official Allure reports using the latest Allure CLI, and automatically creates an interactive standalone HTML dashboard report in `reports/allure-report/index.html`.
  - **View Report**: One-click button to open the generated Allure report in your default browser.

---

### 📊 Allure Reporting & Installation Requirements

Smart Cucumber-Behave integrates with the **latest version of Allure** (Allure 2.x) to generate rich, interactive test analytics and dashboards.

#### 1. Prerequisites: Install Latest Allure CLI
To generate and serve native Allure reports, install the latest version of the Allure command-line tool:
* **npm (Recommended - Cross-Platform)**:
  ```bash
  npm install -g allure-commandline@latest
  ```
* **Windows (Scoop)**:
  ```powershell
  scoop install allure
  ```
* **Windows (Chocolatey)**:
  ```powershell
  choco install allure-commandline
  ```
* **macOS / Linux (Homebrew)**:
  ```bash
  brew install allure
  ```
* **Direct Binary Download**:
  Download the latest distribution from the [Allure Framework Releases](https://github.com/allure-framework/allure2/releases).

Verify that `allure` is in your system `PATH`:
```bash
allure --version
```

#### 2. Install Python `allure-behave`
In your project's active Python environment, install the Behave Allure formatter:
```bash
pip install allure-behave
```

#### 3. Running with Allure Formatter
To output native Allure test result files, run Behave with the formatter flag:
```bash
behave -f allure_behave.formatter:AllureFormatter -o allure-results
```

> [!WARNING]
> **Error Handling When Allure Is Not Found**:
> If the `allure` command is not detected in your system `PATH` when you click **Generate Allure**, the extension will display an error alert:
> ```
> Allure CLI was not found in PATH. Please install the latest Allure CLI: 'npm install -g allure-commandline@latest' (or 'scoop install allure').
> ```
> An action button directly links to the [Allure Installation Documentation](https://allurereport.org/docs/install/).
> As an automatic fallback, a standalone, interactive HTML preview report is also generated in `reports/allure-report/index.html` so you can still review your test metrics immediately.

---

### 🐍 Deep Python Behave Support & Ecosystem
Fully aligned with the official [Behave Documentation](https://behave.readthedocs.io/en/latest/):
- **Universal Step Matchers**:
  - **`parse` (Default Matcher)**: Supports typed placeholders like `{param:d}` (integer), `{param:f}` (float), `{param:w}` (word), `{param:s}` (string), named variables `{param}`, and anonymous `{}` / `"{}"`.
  - **`cfparse` (Cardinality Field Parse)**: Full support for cardinality suffixes like `{param:Type?}` (optional), `{param:Type*}` (0..*), and `{param:Type+}` (1..*).
  - **`re` (Regular Expressions)**: Named capture groups `(?P<name>...)`, standard regex expressions, and `re.compile(...)`.
  - **Quoted Placeholders & Punctuation**: Full support for quoted parameters `'{param}'`, `"{param}"`, anonymous `"{}"`, and trailing periods/punctuation (e.g. `@given("I sleep for '{seconds}' seconds.")`). Flexibly matches single-quoted, double-quoted, or unquoted steps in `.feature` files without undefined-step warnings.
  - **Stacked Decorators**: Supports multiple `@given`, `@when`, `@then`, and `@step` decorators stacked over the same step definition function.
  - Supports `@behave.given`, `@behave.when`, `@behave.then`, `@behave.step` as well as standard `@given`, `@when`, `@then`, `@step`.
  - Robust handling of raw strings (`r"..."`, `ur"..."`, `ru"..."`) and multiline triple quotes (`"""` / `'''`).
- **Behave Configuration Files**:
  - Auto-discovers and parses project configuration files: `behave.ini`, `.behaverc`, `setup.cfg`, `tox.ini`.
  - Reads `default_tags`, formatters, and `[behave.userdata]` parameters (`-D key=value`).
- **Environment & Lifecycle (`features/environment.py`)**:
  - Built-in command and UI button to open or generate `features/environment.py` with standard hooks (`before_all`, `after_all`, `before_feature`, `after_feature`, `before_scenario`, `after_scenario`, `before_step`, `after_step`, `before_tag`, `after_tag`).
  - Scoped `@fixture` definitions with `yield` and `use_fixture(fixture_func, context)`.
- **Rich Python Snippets**:
  - Native Python snippets for steps (`@given`, `@when`, `@then`, `@step`), table processing (`context.table`), docstring payloads (`context.text`), fixtures, and userdata.
- **Tag Filtering & Specialized CLI Workflows**:
  - Run with tag expressions (`--tags`): e.g. `@smoke and not @slow`.
  - Dry run mode (`--dry-run`): validate step definitions without executing test logic.
  - Work-in-progress mode (`--wip`): run scenarios tagged `@wip` and stop on first failure.

---

## 🛠️ Configuration Settings

### Custom Gherkin Formatter Settings
| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `smartBehave.formatting.customIndent.enabled` | `boolean` | `true` | Enable custom keyword indentation for Gherkin files. |
| `smartBehave.formatting.indentCharacter` | `string` | `"auto"` | Indent unit: `"auto"`, `"tab"`, or `"spaces"`. |
| `smartBehave.formatting.indent.feature` | `number` | `0` | Number of tabs/indents for `Feature:` headers. |
| `smartBehave.formatting.indent.scenario` | `number` | `1` | Number of tabs/indents for `Scenario:` headers. |
| `smartBehave.formatting.indent.background` | `number` | `1` | Number of tabs/indents for `Background:` headers. |
| `smartBehave.formatting.indent.given` | `number` | `2` | Number of tabs/indents for `Given` steps. |
| `smartBehave.formatting.indent.when` | `number` | `2` | Number of tabs/indents for `When` steps. |
| `smartBehave.formatting.indent.then` | `number` | `3` | Number of tabs/indents for `Then` steps. |
| `smartBehave.formatting.indent.and` | `number` | `4` | Number of tabs/indents for `And` steps. |
| `smartBehave.formatting.indent.but` | `number` | `4` | Number of tabs/indents for `But` steps. |
| `smartBehave.formatting.indent.examples` | `number` | `2` | Number of tabs/indents for `Examples:` headers. |
| `smartBehave.formatting.relativeAnd` | `boolean` | `false` | If true, `And`/`But` indent +1 tab relative to preceding step. |

### Cucumber Settings
| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cucumber.features` | `string[]` | `["src/test/**/*.feature", "features/**/*.feature", "tests/**/*.feature", "*specs*/**/*.feature"]` | Glob patterns for Gherkin `.feature` files. |
| `cucumber.glue` | `string[]` | `["*specs*/**/*.cs", "features/**/*.js", "features/**/*.jsx", "features/**/*.php", "features/**/*.py", "features/**/*.rs", "features/**/*.rb", "features/**/*.ts", "features/**/*.tsx", "features/**/*_test.go", "src/test/**/*.java", "tests/**/*.py", "tests/**/*.rs"]` | Glob patterns for step definitions across all languages. |
| `cucumber.parameterTypes` | `array` | `[]` | Custom Cucumber Parameter Types definitions. |

### Behave Runner Settings
| Setting | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `smartBehave.featureFiles.patterns` | `string[]` | `["**/*.feature"]` | Glob patterns for Behave feature files. |
| `smartBehave.stepDefinitions.patterns` | `string[]` | `["**/steps/**/*.py", "**/*_steps.py", "**/step_*.py", "**/steps.py"]` | Glob patterns for Python step definition files. |
| `smartBehave.autoDiscover` | `boolean` | `true` | Automatically discover and index all tests on startup. |
| `smartBehave.codeLens` | `boolean` | `false` | Enable or disable in-editor CodeLens (Run/Debug buttons). |
| `smartBehave.arguments` | `string[]` | `["-f", "pretty"]` | Additional CLI arguments to pass to `behave`. |
| `smartBehave.extraArgs` | `string[]` | `[]` | Extra arguments passed to behave on every run and debug launch. |
| `smartBehave.configDirectory` | `string` | `"configs"` | Directory where capability and properties files are stored. |
| `smartBehave.diffRegex` | `string[]` | `["Expected: (?<expected>.*)[\\s\\S]*but: was (?<actual>.*)"]` | Regex patterns to extract expected vs. actual values for failure diffs. |

---

## ⌨️ Commands

| Command | Title | Description |
| :--- | :--- | :--- |
| `smartBehave.formatCustomGherkin` | `Smart Cucumber-Behave: Format Feature with Custom Indentation` | Format active `.feature` file using custom indentation levels. |
| `smartBehave.openConfiguration` | `Smart Behave: Open Configuration Screen` | Open the multi-language interactive configuration webview. |
| `smartBehave.selectConfigFile` | `Smart Behave: Select Configuration / Capabilities File` | QuickPick to switch active caps/config file. |
| `smartBehave.run` | `Smart Behave: Run` | Run the selected feature or scenario. |
| `smartBehave.debug` | `Smart Behave: Debug` | Debug the selected feature or scenario with `debugpy`. |
| `smartBehave.cancelRun` | `Smart Behave: Cancel Run` | Terminate running test process with confirmation. |
| `smartBehave.rerunLastRun` | `Smart Behave: Rerun Last Run` | Rerun the last executed test session. |
| `smartBehave.showLiveRun` | `Smart Behave: Show Cucumber-Behave Panel` | Focus the Cucumber-Behave Activity Bar / Sidebar view. |
| `smartBehave.generateAllureReport` | `Cucumber-Behave: Generate Allure Report` | Generate Allure report using Allure CLI or interactive HTML generator. |
| `smartBehave.viewAllureReport` | `Cucumber-Behave: View Allure Report` | Open the generated Allure report in default browser. |
| `smartBehave.clearResults` | `Cucumber-Behave: Clear Test Results History` | Clear saved test execution history. |
| `smartBehave.refreshDiscovery` | `Cucumber-Behave: Refresh Feature Discovery` | Rescan workspace and `features/` directory for feature files. |
| `smartBehave.generateStepDefinition` | `Smart Behave: Generate Step Definition in Python` | Generate Python step definition code snippet. |
| `smartBehave.runWithTags` | `Smart Cucumber-Behave: Run with Tags (--tags)` | Prompt for Behave tag expression (e.g. `@smoke and not @slow`) and execute tests. |
| `smartBehave.runDryRun` | `Smart Cucumber-Behave: Dry Run (--dry-run)` | Validate step definitions and matchers without executing test logic. |
| `smartBehave.runWip` | `Smart Cucumber-Behave: Run Work-In-Progress (--wip)` | Execute scenarios tagged `@wip` and stop on first failure. |
| `smartBehave.openEnvironmentFile` | `Smart Cucumber-Behave: Open/Create features/environment.py` | Open or generate `features/environment.py` with Behave lifecycle hooks and fixtures. |

---

## 🐛 Issues, Feature Requests & Feedback

We welcome bug reports, suggestions, and feature contributions!

* **Issue Tracker**: [https://github.com/GauravWardhekara/smart-cucumber-behave/issues](https://github.com/GauravWardhekara/smart-cucumber-behave/issues)
* When reporting issues, please include:
  1. Operating System (Windows, macOS, Linux)
  2. VS Code / Antigravity IDE version
  3. Python version & Behave version (`behave --version`)
  4. Minimal reproducible `.feature` and step definition code
  5. Any output logs from the **Output** channel (`Smart Behave`) or browser console.

---

## 🙏 Acknowledgements & Open-Source Credits

Smart Cucumber-Behave stands on the shoulders of these outstanding open-source projects, communities, and authors:

* **[Cucumber for Visual Studio Code (`cucumber/vscode`)](https://github.com/cucumber/vscode)**:
  - Official Cucumber extension developed by SmartBear and the Cucumber Open Source Community.
  - Source for the official `@cucumber/language-server`, `@cucumber/language-service`, `@cucumber/cucumber-expressions`, and tree-sitter WebAssembly (WASM) grammars powering multilingual step indexing, diagnostics, autocompletion, and semantic tokens.
  - Licensed under the [MIT License](https://github.com/cucumber/vscode/blob/main/LICENSE).

* **[Behave (`behave/behave`)](https://github.com/behave/behave)**:
  - Behavior-driven development test framework for Python by Jens Engel, Benno Rice, and contributors.
  - Architectural specifications and documentation for Behave step matchers (`parse`, `cfparse`, `re`), configuration discovery (`behave.ini`, `.behaverc`, `setup.cfg`, `tox.ini`), and lifecycle hooks (`features/environment.py`).
  - Licensed under the [BSD 2-Clause License](https://github.com/behave/behave/blob/master/LICENSE).

* **[behave-vsc (`simplytest/behave-vsc`)](https://github.com/simplytest/behave-vsc)**:
  - Copyright (c) Curve & SimplyTest.
  - Original VS Code Behave integration foundation and command inspiration.
  - Licensed under the [MIT License](https://github.com/simplytest/behave-vsc/blob/main/LICENSE).

* **[behave-runner (`RemoYukoff/behave-runner`)](https://github.com/RemoYukoff/behave-runner)**:
  - Copyright (c) Remo Yukoff.
  - Behave test discovery and execution concepts.
  - Licensed under the [MIT License](https://github.com/RemoYukoff/behave-runner/blob/master/LICENSE).

* **[Tree-Sitter (`tree-sitter/tree-sitter`)](https://github.com/tree-sitter/tree-sitter)**:
  - Fast, incremental parser generator by Max Brunsfeld and the Tree-Sitter community.
  - Powers syntax parsing and AST queries across Python, JavaScript, TypeScript, Java, C#, Ruby, PHP, Rust, and Go.
  - Licensed under the [MIT License](https://github.com/tree-sitter/tree-sitter/blob/master/LICENSE).

* **[parse (`r1chardj0n3s/parse`)](https://github.com/r1chardj0n3s/parse)**:
  - Fast Python string parsing library by Richard Jones, powering Behave's format expression matching.
  - Licensed under the [MIT License](https://github.com/r1chardj0n3s/parse/blob/master/LICENSE).

* **[debugpy (`microsoft/debugpy`)](https://github.com/microsoft/debugpy)**:
  - Microsoft's Python debugger implementation for VS Code, enabling breakpoint debugging in Behave step definitions and hooks.
  - Licensed under the [MIT License](https://github.com/microsoft/debugpy/blob/main/LICENSE).

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
