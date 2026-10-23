import * as fs from "fs";
import * as path from "path";

// Mock vscode module when running outside VS Code Extension Host
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "vscode") {
    return {
      window: {
        showQuickPick: () => Promise.resolve(undefined),
        createOutputChannel: () => ({
          append: () => {},
          appendLine: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          dispose: () => {}
        })
      },
      workspace: {
        getWorkspaceFolder: () => undefined,
        getConfiguration: () => ({ get: () => undefined })
      },
      Uri: { file: (f: string) => ({ fsPath: f }) },
      Position: class {
        constructor(public line: number, public character: number) {}
      },
      Range: class {
        start: any;
        end: any;
        constructor(public startLine: number, public startChar: number, public endLine: number, public endChar: number) {
          this.start = { line: startLine, character: startChar };
          this.end = { line: endLine, character: endChar };
        }
      },
      Location: class {
        constructor(public uri: any, public rangeOrPosition: any) {}
      },
      TestMessage: class {
        expectedOutput?: string;
        actualOutput?: string;
        location?: any;
        constructor(public message: string) {}
      },
      TestRunRequest: class {
        constructor(public include?: any[]) {}
      },
      TestRunProfileKind: { Run: 1, Debug: 2 },
      tests: {
        createTestController: (id: string, label: string) => {
          const items = new Map();
          return {
            items,
            createTestItem: (itemId: string, itemLabel: string, uri: any) => ({
              id: itemId,
              label: itemLabel,
              uri,
              children: new Map(),
              range: undefined
            }),
            createTestRun: () => ({
              started: () => {},
              passed: () => {},
              failed: () => {},
              skipped: () => {},
              end: () => {}
            }),
            createRunProfile: () => ({ dispose: () => {} })
          };
        }
      }
    };
  }
  return originalRequire.apply(this, arguments);
};

import { parseFeatureFile } from "../src/core/featureParser";
import { parseStepDefinitionsFromPython } from "../src/core/pythonStepDecorators";
import { findMatchingDefinitions, parseStepLine } from "../src/core/stepMatcher";
import { computeFeatureSemanticTokenSpans } from "../src/core/featureSemanticTokens";
import { computeFeatureFormatLineEdits } from "../src/core/featureFormat";
import { escapeBehaveNameSelect } from "../src/core/behaveNameSelect";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

const exampleFeaturePath = path.resolve(__dirname, "../example/features/basic.feature");
const exampleStepPath = path.resolve(__dirname, "../example/features/steps/basic.py");

// 1. Verify feature file parser
const featureContent = fs.readFileSync(exampleFeaturePath, "utf-8");
const parsedFeature = parseFeatureFile(exampleFeaturePath, featureContent);
assert(parsedFeature.name === "Test Environment", "Feature name matches");
assert(parsedFeature.scenarios.length === 3, "Found 3 scenarios");
assert(parsedFeature.scenarios[0].name === "First", "First scenario name is First");
assert(parsedFeature.scenarios[0].steps.length === 2, "First scenario has 2 steps");

// 2. Verify python step decorator parser
const pythonContent = fs.readFileSync(exampleStepPath, "utf-8");
const stepDefs = parseStepDefinitionsFromPython(exampleStepPath, pythonContent);
assert(stepDefs.length === 2, `Found 2 step definitions (actual: ${stepDefs.length})`);
assert(stepDefs[0].keyword === "when", "First step def is @when");
assert(stepDefs[1].keyword === "then", "Second step def is @then");

// 3. Verify step matcher
const step1 = parsedFeature.scenarios[0].steps[0];
const stepInfo1 = parseStepLine(`${step1.keyword} ${step1.text}`);
assert(stepInfo1 !== null, "Step line parsed");
const matches = findMatchingDefinitions(stepInfo1!.text, stepInfo1!.effectiveKeyword, stepDefs);
assert(matches.length > 0, "Step matched Python definition");
assert(matches[0].filePath === exampleStepPath, "Matched definition file matches");

// 4. Verify semantic tokens
const tokens = computeFeatureSemanticTokenSpans(featureContent);
assert(tokens.length > 0, `Generated semantic tokens (count: ${tokens.length})`);

// 5. Verify document formatting
const lines = featureContent.split(/\r?\n/);
const edits = computeFeatureFormatLineEdits(lines, 0, lines.length - 1, {
  insertSpaces: true,
  tabSize: 4,
});
console.log(`PASS: Computed ${edits.length} formatting edits`);

// 6. Verify exact scenario name matching and anchoring
assert(escapeBehaveNameSelect("First") === "^First$", "escapeBehaveNameSelect anchors with ^ and $");
assert(escapeBehaveNameSelect("Hello (World) [test]") === "^Hello \\(World\\) \\[test\\]$", "escapeBehaveNameSelect escapes regex symbols");

// 7. Verify enhanced step expressions (Behave parse types & Cucumber expressions)
const { behavePatternToRegex, getStepTextInvariants } = require("../src/core/stepMatcher");
assert(behavePatternToRegex("I have {n:d} apples").test("I have 42 apples"), "Matches integer placeholder {n:d}");
assert(behavePatternToRegex("the cost is {cost:f}").test("the cost is 19.99"), "Matches float placeholder {cost:f}");
assert(behavePatternToRegex("user {name:w} logs in").test("user Alice logs in"), "Matches word placeholder {name:w}");
assert(behavePatternToRegex("user {word} logs in").test("user Alice logs in"), "Matches Cucumber {word}");
assert(behavePatternToRegex("user {string} logs in").test('user "Bob" logs in'), "Matches Cucumber {string}");
assert(behavePatternToRegex("I buy {count:int} items").test("I buy 5 items"), "Matches Cucumber {int}");
assert(behavePatternToRegex("I have an apple(s)").test("I have an apple"), "Matches singular with optional (s)");
assert(behavePatternToRegex("I have an apple(s)").test("I have an apples"), "Matches plural with optional (s)");
assert(behavePatternToRegex("I select red/blue").test("I select red"), "Matches alternative word slash red/blue");

// 8. Verify pattern invariants expansion
const variants = getStepTextInvariants("user logs in/out");
assert(variants.length === 2 && variants.includes("user logs in") && variants.includes("user logs out"), "Expands slash invariants");

// 9. Verify Python step snippet generation
const { generateStepSnippet } = require("../src/core/stepSnippetGenerator");
const gen = generateStepSnippet("when", 'I enter "alice" and 3 items');
assert(gen.decoratorKeyword === "when", "Generated decorator is @when");
assert(gen.paramNames.length === 2, "Extracted 2 parameters");
assert(gen.code.includes("def step_impl(context,"), "Generated function signature with context and params");

// 10. Verify JSON docstring formatting
const docstringFeature = [
  "Feature: Docstring test",
  "  Scenario: Post JSON",
  "    When I send payload:",
  '      """',
  '      {"name":"test","count":1}',
  '      """'
];
const docEdits = computeFeatureFormatLineEdits(docstringFeature, 0, docstringFeature.length - 1, {
  insertSpaces: true,
  tabSize: 4
});
assert(docEdits.some(e => e.newText.includes('"""')), "Docstring delimiters formatted");

// 11. Verify smartBehaveArgs launch config parser
const { splitCommandLineArgs, getLaunchJsonSmartBehaveArgs } = require("../src/run/behaveLaunchConfig");
const sampleArgs = "-D property_file=configs/config.properties -D endpoint_file=endpoints.json -D caps_file=ios_caps_v5.json -D log_level=DEBUG";
const split = splitCommandLineArgs(sampleArgs);
assert(split.length === 8, `splitCommandLineArgs split 8 args (actual: ${split.length})`);
assert(split[0] === "-D" && split[1] === "property_file=configs/config.properties", "First -D arg matches");
assert(split[7] === "log_level=DEBUG", "Last -D arg matches");

const exampleLaunchJsonArgs = getLaunchJsonSmartBehaveArgs(path.resolve(__dirname, "../example"));
assert(exampleLaunchJsonArgs.length === 8, `Parsed example launch.json args (actual: ${exampleLaunchJsonArgs.length})`);
assert(exampleLaunchJsonArgs[3] === "endpoint_file=endpoints.json", "Parsed endpoint_file argument");

// 12. Verify config file detector & caps_file arg injection
const { detectConfigFiles, applyCapsFileArg } = require("../src/run/behaveConfigFile");
const exampleRoot = path.resolve(__dirname, "../example");
const detected = detectConfigFiles(exampleRoot, "configs");
assert(detected.length >= 3, `Detected at least 3 config files in example/configs (found: ${detected.length})`);
assert(detected.includes("configs/android_caps_v1.json"), "Found android_caps_v1.json");
assert(detected.includes("configs/ios_caps_v5.json"), "Found ios_caps_v5.json");
assert(detected.includes("configs/config.properties"), "Found config.properties");

// Verify replacing caps_file in existing extraArgs
const updatedArgs = applyCapsFileArg(exampleLaunchJsonArgs, "configs/android_caps_v1.json");
assert(updatedArgs.length === 8, `Updated args retains 8 tokens (actual: ${updatedArgs.length})`);
assert(updatedArgs.includes("caps_file=configs/android_caps_v1.json"), "Injected selected android caps file with relative path");
assert(!updatedArgs.includes("caps_file=ios_caps_v5.json"), "Replaced old caps_file");
assert(updatedArgs.includes("property_file=configs/config.properties"), "Preserved other properties");

// Verify appending caps_file when none exists
const cleanArgs = applyCapsFileArg(["-f", "pretty"], "configs/custom_caps.json");
assert(cleanArgs.length === 4, "Appended -D and caps_file");
assert(cleanArgs[2] === "-D" && cleanArgs[3] === "caps_file=configs/custom_caps.json", "Appended caps_file argument with relative path");

// 13. Verify scenario & feature pass/fail propagation in ActiveTestRunSession
const { ActiveTestRunSession, BehaveTestControllerManager } = require("../src/testController");

const mockManager = new BehaveTestControllerManager();
const featureUri = { fsPath: exampleFeaturePath };

const mockFeatureItem = {
  id: exampleFeaturePath,
  label: "Test Environment",
  uri: featureUri,
  children: new Map(),
  range: { start: { line: 0 } }
};

const mockSc1 = {
  id: `${exampleFeaturePath}:4`,
  label: "First",
  uri: featureUri,
  range: { start: { line: 4 } },
  children: new Map()
};

const mockSc2 = {
  id: `${exampleFeaturePath}:10`,
  label: "Second",
  uri: featureUri,
  range: { start: { line: 10 } },
  children: new Map()
};

mockFeatureItem.children.set(mockSc1.id, mockSc1);
mockFeatureItem.children.set(mockSc2.id, mockSc2);
mockManager.getController().items.set(exampleFeaturePath, mockFeatureItem);

// Test Case 1: When one scenario fails, it fails and the whole feature fails
const testEvents1: string[] = [];
const mockRun1 = {
  started: (item: any) => testEvents1.push(`started:${item.label}`),
  passed: (item: any) => testEvents1.push(`passed:${item.label}`),
  failed: (item: any, msg: any) => testEvents1.push(`failed:${item.label}`),
  skipped: (item: any) => testEvents1.push(`skipped:${item.label}`),
  end: () => testEvents1.push("end")
};

const session1 = new ActiveTestRunSession(mockManager.getController(), mockRun1, mockManager);
session1.onScenarioStarted(exampleFeaturePath, "First", `${exampleFeaturePath}:5`);
session1.onScenarioFinished(exampleFeaturePath, "First", `${exampleFeaturePath}:5`, "passed");
session1.onScenarioStarted(exampleFeaturePath, "Second", `${exampleFeaturePath}:11`);
session1.onStepFinished(exampleFeaturePath, "Second", `${exampleFeaturePath}:12`, "When", "step fails", "failed", "AssertionError: expected True but got False");
session1.onScenarioFinished(exampleFeaturePath, "Second", `${exampleFeaturePath}:11`, "failed");
session1.onFeatureFinished(exampleFeaturePath, "Test Environment", "failed");
session1.onRunFinished(1);

assert(testEvents1.includes("passed:First"), "Scenario First marked as passed");
assert(testEvents1.includes("failed:Second"), "Scenario Second marked as failed");
assert(testEvents1.includes("failed:Test Environment"), "Feature marked as failed when a scenario fails");

// Test Case 2: When all scenarios pass, all scenarios pass and the whole feature passes
const testEvents2: string[] = [];
const mockRun2 = {
  started: (item: any) => testEvents2.push(`started:${item.label}`),
  passed: (item: any) => testEvents2.push(`passed:${item.label}`),
  failed: (item: any, msg: any) => testEvents2.push(`failed:${item.label}`),
  skipped: (item: any) => testEvents2.push(`skipped:${item.label}`),
  end: () => testEvents2.push("end")
};

const session2 = new ActiveTestRunSession(mockManager.getController(), mockRun2, mockManager);
session2.onScenarioStarted(exampleFeaturePath, "First", `${exampleFeaturePath}:5`);
session2.onScenarioFinished(exampleFeaturePath, "First", `${exampleFeaturePath}:5`, "passed");
session2.onScenarioStarted(exampleFeaturePath, "Second", `${exampleFeaturePath}:11`);
session2.onScenarioFinished(exampleFeaturePath, "Second", `${exampleFeaturePath}:11`, "passed");
session2.onFeatureFinished(exampleFeaturePath, "Test Environment", "passed");
session2.onRunFinished(0);

assert(testEvents2.includes("passed:First"), "Scenario First marked as passed");
assert(testEvents2.includes("passed:Second"), "Scenario Second marked as passed");
assert(testEvents2.includes("passed:Test Environment"), "Whole feature marked as passed when all scenarios pass");
assert(!testEvents2.some(e => e.startsWith("failed:")), "No failures recorded when all pass");

// 14. Verify Cucumber Language Server WASM files and components
const wasmDir = path.resolve(__dirname, "../out");
const expectedWasms = [
  "c_sharp.wasm",
  "go.wasm",
  "java.wasm",
  "php.wasm",
  "python.wasm",
  "ruby.wasm",
  "rust.wasm",
  "tree-sitter.wasm",
  "tsx.wasm"
];
for (const wasm of expectedWasms) {
  const wasmPath = path.join(wasmDir, wasm);
  assert(fs.existsSync(wasmPath), `WASM file exists: ${wasm}`);
}

const pkgPath = path.resolve(__dirname, "../package.json");
const pkgData = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
assert(pkgData.name === "smart-cucumber-behave", "package.json name is smart-cucumber-behave");
assert(pkgData.displayName === "Smart Cucumber-Behave", "package.json displayName is Smart Cucumber-Behave");
const langIds = pkgData.contributes.languages.map((l: any) => l.id);
assert(langIds.includes("cucumber"), "Contributes 'cucumber' language");
assert(langIds.includes("behave"), "Contributes 'behave' language");

// 15. Verify Custom Gherkin Formatter (Feature=0, Scenario=1, Background=1, Given=2, When=2, Then=3, And=4, But=4)
const { formatGherkinDocument } = require("../src/core/featureFormat");
const rawGherkin = `
Feature: User Login
Background: Setup
Given the server is up
Scenario: User logs in successfully
Given the login page is open
When the user submits credentials
Then the dashboard is displayed
And a welcome message appears
But error banner is not visible
`;

const formattedGherkin = formatGherkinDocument(rawGherkin, {
  insertSpaces: false,
  tabSize: 4,
  customIndent: {
    enabled: true,
    indentCharacter: "tab",
    feature: 0,
    scenario: 1,
    background: 1,
    given: 2,
    when: 2,
    then: 3,
    and: 4,
    but: 4,
  }
});

const formattedLines = formattedGherkin.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
assert(formattedLines[0] === "Feature: User Login", "Feature has no tab (0 tabs)");
assert(formattedLines[1] === "\tBackground: Setup", "Background has 1 tab");
assert(formattedLines[2] === "\t\tGiven the server is up", "Background Given has 2 tabs");
assert(formattedLines[3] === "\tScenario: User logs in successfully", "Scenario has 1 tab after Feature");
assert(formattedLines[4] === "\t\tGiven the login page is open", "Given has 2 tabs (one more tab after Scenario)");
assert(formattedLines[5] === "\t\tWhen the user submits credentials", "When has 2 tabs");
assert(formattedLines[6] === "\t\t\tThen the dashboard is displayed", "Then has 3 tabs (one more tab after Given)");
assert(formattedLines[7] === "\t\t\t\tAnd a welcome message appears", "And has 4 tabs (one more tab after Then)");
assert(formattedLines[8] === "\t\t\t\tBut error banner is not visible", "But has 4 tabs");

// 16. Verify Multi-Language Runtime Diagnostic Probing for all 8 supported languages
const { probeAllLanguageRuntimes } = require("../src/utils/languageRuntimes");
async function testRuntimes() {
  const probedRuntimes = await probeAllLanguageRuntimes();
  assert(probedRuntimes.length === 8, `Probed exactly 8 language runtimes (actual: ${probedRuntimes.length})`);
  const runtimeIds = probedRuntimes.map((r: any) => r.id);
  assert(runtimeIds.includes("python"), "Includes Python runtime probe");
  assert(runtimeIds.includes("javascript"), "Includes JavaScript/TypeScript runtime probe");
  assert(runtimeIds.includes("java"), "Includes Java runtime probe");
  assert(runtimeIds.includes("csharp"), "Includes C#/.NET runtime probe");
  assert(runtimeIds.includes("ruby"), "Includes Ruby runtime probe");
  assert(runtimeIds.includes("php"), "Includes PHP runtime probe");
  assert(runtimeIds.includes("rust"), "Includes Rust runtime probe");
  assert(runtimeIds.includes("go"), "Includes Go runtime probe");

  console.log("\nALL VERIFICATION CHECKS PASSED!");
}
void testRuntimes().then(async () => {
  // 17. Verify Python Behave Step Normalization for Cucumber Language Server
  console.log("\n--- Verifying Python Behave Step Normalization for Cucumber LSP ---");
  const { normalizeBehavePythonForCucumber } = require("../src/VscodeFiles");
  const { WasmParserAdapter } = require("@cucumber/language-service/wasm");
  const { ExpressionBuilder, getGherkinDiagnostics } = require("@cucumber/language-service");

  // Test Case 17.1: Decorator transformation rules
  const sampleBehaveCode = `
@behave.given(r"^I have (?P<count>\\d+) items in cart$")
def step_impl_1(context, count): pass

@when(u"I type in '{name}'")
def step_impl_2(context, name): pass

@then("""I should see {cost:f} total""")
def step_impl_3(context, cost): pass

@step('user {user:w} has {n:d} apples')
def step_impl_4(context, user, n): pass
`;

  const normalized = normalizeBehavePythonForCucumber(sampleBehaveCode);
  assert(normalized.includes('@given("/^I have (\\d+) items in cart$/")'), "Normalizes @behave.given, raw string prefix and (?P<count>\\d+) named group");
  assert(normalized.includes("I type in") && normalized.includes("/^") && normalized.includes("$/"), "Normalizes u'...' prefix and '{name}' placeholder");
  assert(normalized.includes("I should see") && normalized.includes("total"), "Normalizes triple quotes and {cost:f} float placeholder");
  assert(normalized.includes("user") && normalized.includes("apples"), "Normalizes @step, {user:w} and {n:d}");

  // Test Case 17.2: Integration test with Tree-Sitter & ExpressionBuilder
  const adapter = new WasmParserAdapter(path.resolve(__dirname, "../out"));
  await adapter.init();
  const eb = new ExpressionBuilder(adapter);

  const basicPy = fs.readFileSync(exampleStepPath, "utf-8");
  const outlinePy = fs.readFileSync(path.resolve(__dirname, "../example/features/steps/outline.py"), "utf-8");

  const sources = [
    {
      languageName: "python",
      content: normalizeBehavePythonForCucumber(basicPy),
      uri: "file:///example/features/steps/basic.py"
    },
    {
      languageName: "python",
      content: normalizeBehavePythonForCucumber(outlinePy),
      uri: "file:///example/features/steps/outline.py"
    }
  ];

  const res = eb.build(sources, []);
  assert(res.errors.length === 0, `ExpressionBuilder produced 0 errors on Behave step definitions (actual errors: ${res.errors.length})`);
  assert(res.expressionLinks.length >= 6, `ExpressionBuilder indexed at least 6 step definitions (actual: ${res.expressionLinks.length})`);

  const expressions = res.expressionLinks.map((l: any) => l.expression);

  // Test Case 17.3: Diagnostics check on outline.feature and basic.feature
  const outlineFeatureContent = fs.readFileSync(path.resolve(__dirname, "../example/features/outline.feature"), "utf-8");
  const diagsOutline = getGherkinDiagnostics(outlineFeatureContent, expressions);
  assert(diagsOutline.length === 0, `outline.feature has 0 undefined step diagnostics (actual: ${diagsOutline.length})`);

  const diagsBasic = getGherkinDiagnostics(featureContent, expressions);
  assert(diagsBasic.length === 0, `basic.feature has 0 undefined step diagnostics (actual: ${diagsBasic.length})`);

  // 18. Verify Behave Documentation Features (cfparse, universal decorators, behave.ini, snippets)
  console.log("\n--- Verifying Behave Documentation Features ---");
  const { tryParseBehaveStepDecoratorLine, parseStepDefinitionsFromPython } = require("../src/core/pythonStepDecorators");
  const { parseBehaveConfigFile } = require("../src/run/behaveConfigFile");

  // 18.1 cfparse Cardinality Field Matching
  const reOptional = behavePatternToRegex("I select {opt:w?}");
  assert(reOptional.test("I select"), "Matches cfparse optional empty value: 'I select'");
  assert(reOptional.test("I select apple"), "Matches cfparse optional word: 'I select apple'");

  const rePlus = behavePatternToRegex("numbers {n:d+}");
  assert(rePlus.test("numbers 123"), "Matches cfparse one-or-more: 'numbers 123'");
  assert(rePlus.test("numbers 123, 456"), "Matches cfparse multiple: 'numbers 123, 456'");

  // 18.2 Universal Decorator Parsing (@behave.given, re.compile, triple quotes)
  const d1 = tryParseBehaveStepDecoratorLine("@behave.given(r'^order (\\d+) created$')");
  assert(d1 !== null && d1.keyword === "given" && d1.pattern === "^order (\\d+) created$", "Parses @behave.given with raw regex");

  const d2 = tryParseBehaveStepDecoratorLine("@then(re.compile(r'^status is 200$'))");
  assert(d2 !== null && d2.keyword === "then" && d2.pattern === "^status is 200$", "Parses @then with re.compile");

  const d3 = tryParseBehaveStepDecoratorLine('@step("""user enters multi text""")');
  assert(d3 !== null && d3.keyword === "step" && d3.pattern === "user enters multi text", "Parses @step with triple quotes");

  // 18.3 Behave Configuration File Parser (behave.ini)
  const sampleIni = `
[behave]
default_tags = not (@xfail or @not_implemented)
format = progress3
junit = true
junit_directory = build/behave.reports
dry_run = false
wip = false
logging_level = INFO

[behave.userdata]
env = staging
browser = firefox
`;
  const tempIniPath = path.resolve(__dirname, "../out/test_behave.ini");
  fs.writeFileSync(tempIniPath, sampleIni, "utf-8");
  const parsedIni = parseBehaveConfigFile(tempIniPath);
  fs.unlinkSync(tempIniPath);

  assert(parsedIni !== null, "Parsed behave.ini successfully");
  assert(parsedIni!.defaultTags === "not (@xfail or @not_implemented)", "Parsed default_tags");
  assert(parsedIni!.format === "progress3", "Parsed format");
  assert(parsedIni!.junit === true, "Parsed junit boolean");
  assert(parsedIni!.userdata["env"] === "staging", "Parsed userdata env");
  assert(parsedIni!.userdata["browser"] === "firefox", "Parsed userdata browser");

  // 18.4 Python Snippets File Validation
  const pythonSnippetsPath = path.resolve(__dirname, "../snippets/python.json");
  assert(fs.existsSync(pythonSnippetsPath), "snippets/python.json exists");
  const pySnippets = JSON.parse(fs.readFileSync(pythonSnippetsPath, "utf-8"));
  assert(Boolean(pySnippets["Behave @given step"]), "Contains Behave @given snippet");
  assert(Boolean(pySnippets["Behave environment.py template"]), "Contains environment.py template snippet");
  assert(Boolean(pySnippets["Behave @fixture generator"]), "Contains Behave @fixture snippet");
  assert(Boolean(pySnippets["Behave use_step_matcher"]), "Contains use_step_matcher snippet");
  assert(Boolean(pySnippets["Behave userdata get"]), "Contains userdata access snippet");

  console.log("\nALL BEHAVE DOCUMENTATION VERIFICATION CHECKS PASSED!");

  // 19. Verify Stacked Behave Decorators with Quoted Placeholders & Periods (User Issue)
  console.log("\n--- Verifying Stacked Behave Decorators with Quoted Placeholders & Trailing Periods ---");
  const userMultiDecoratorPython = `
@given("I sleep for '{seconds}' seconds.")
@when("I sleep for '{seconds}' seconds.")
@then("I sleep for '{seconds}' seconds.")
@given(u'I sleep for "{seconds}" seconds.')
@when(u'I sleep for "{seconds}" seconds.')
@then(u'I sleep for "{seconds}" seconds.')
@given('I sleep for "{seconds}" seconds.')
@when('I sleep for "{seconds}" seconds.')
@then('I sleep for "{seconds}" seconds.')
def sleep_seconds(context, seconds):
    perform_sleep(context.logger, float(seconds))
`;

  const userNormalized = normalizeBehavePythonForCucumber(userMultiDecoratorPython);
  const userSources = [
    {
      languageName: "python",
      content: userNormalized,
      uri: "file:///example/features/steps/sleep_steps.py"
    }
  ];

  const userEb = new ExpressionBuilder(adapter);
  const userRes = userEb.build(userSources, []);
  assert(userRes.errors.length === 0, `ExpressionBuilder parsed all 9 stacked decorators with 0 errors (actual: ${userRes.errors.length})`);
  assert(userRes.expressionLinks.length === 9, `ExpressionBuilder indexed all 9 stacked decorators (actual: ${userRes.expressionLinks.length})`);

  const userExpressions = userRes.expressionLinks.map((l: any) => l.expression);

  const testFeatureText = `
Feature: Sleep feature validation
  Scenario: Steps with single quotes
    Given I sleep for '5' seconds.
    When I sleep for '10' seconds.
    Then I sleep for '15' seconds.

  Scenario: Steps with double quotes
    Given I sleep for "5" seconds.
    When I sleep for "10" seconds.
    Then I sleep for "15" seconds.

  Scenario: Steps unquoted
    Given I sleep for 5 seconds.
    When I sleep for 10 seconds.
    Then I sleep for 15 seconds.
`;

  const userDiags = getGherkinDiagnostics(testFeatureText, userExpressions);
  assert(userDiags.length === 0, `All steps across single, double, and unquoted matched with 0 undefined-step diagnostics (actual: ${userDiags.length})`);

  console.log("ALL STACKED DECORATOR VERIFICATION CHECKS PASSED!");

  // 20. Verify Steps with Slash Phrases (e.g. date/time) and Hyphenated Identifiers
  console.log("\n--- Verifying Steps with Literal Slashes (e.g. date/time) ---");
  const maximoPy = `
@then("I verify the Finding '{finding}' for '{insp}' has Completed By date/time matching '{time}' via Maximo REST API.")
def step_impl_maximo(context, finding, insp, time): pass
`;
  const normalizedMaximo = normalizeBehavePythonForCucumber(maximoPy);
  const maximoSources = [
    {
      languageName: "python",
      content: normalizedMaximo,
      uri: "file:///example/features/steps/maximo_steps.py"
    }
  ];

  const maximoEb = new ExpressionBuilder(adapter);
  const maximoRes = maximoEb.build(maximoSources, []);
  assert(maximoRes.errors.length === 0, "ExpressionBuilder produced 0 errors for date/time step");
  assert(maximoRes.expressionLinks.length === 1, "ExpressionBuilder indexed date/time step");

  const maximoFeature = `
Feature: Maximo REST API Verification
  Scenario: Verify finding completed date/time
    Then I verify the Finding 'AWM-4146 Finding Updated' for 'edi_insp_rv' has Completed By date/time matching 'edi_finding_completed_time_rv' via Maximo REST API.
`;

  const maximoDiags = getGherkinDiagnostics(maximoFeature, maximoRes.expressionLinks.map((l: any) => l.expression));
  assert(maximoDiags.length === 0, `date/time step produced 0 undefined-step diagnostics (actual: ${maximoDiags.length})`);

  // Also verify with internal stepMatcher
  const reMaximo = behavePatternToRegex("I verify the Finding '{finding}' for '{insp}' has Completed By date/time matching '{time}' via Maximo REST API.");
  assert(
    reMaximo.test("I verify the Finding 'AWM-4146 Finding Updated' for 'edi_insp_rv' has Completed By date/time matching 'edi_finding_completed_time_rv' via Maximo REST API."),
    "stepMatcher accurately matches literal 'date/time' with quoted parameters"
  );

  console.log("ALL SLASH PHRASE & MAXIMO VERIFICATION CHECKS PASSED!");

  // 21. Verify Cucumber-Behave Tab in Activity Bar & 3-Tab Architecture & Allure Reports
  console.log("\n--- Verifying Activity Bar Placement, 3-Tab Layout & Allure Reports ---");
  const pkgContent = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));
  assert(pkgContent.version === "1.1.0", `package.json version is 1.1.0 (actual: ${pkgContent.version})`);
  assert(pkgContent.bugs?.url === "https://github.com/GauravWardhekara/smart-cucumber-behave/issues", "package.json has issue reporting url");
  assert(pkgContent.contributes.viewsContainers?.activitybar?.length > 0, "contributes.viewsContainers.activitybar exists");
  assert(
    pkgContent.contributes.viewsContainers.activitybar[0].id === "cucumberBehaveViewContainer",
    "activitybar container id is cucumberBehaveViewContainer"
  );
  assert(
    pkgContent.contributes.viewsContainers.activitybar[0].title === "Cucumber-Behave",
    "activitybar container title is Cucumber-Behave"
  );
  assert(
    pkgContent.contributes.views?.cucumberBehaveViewContainer?.length > 0,
    "contributes.views.cucumberBehaveViewContainer exists"
  );
  assert(
    pkgContent.contributes.views.cucumberBehaveViewContainer[0].id === "smartBehave.liveRun",
    "webview view id is smartBehave.liveRun"
  );

  // Verify Results Manager & Standalone Allure Report Generation
  const { behaveResultsManager } = require("../src/run/behaveResultsManager");
  behaveResultsManager.clearRecords();
  behaveResultsManager.recordScenario({
    featureName: "Login Feature",
    featureFilePath: "/workspace/features/login.feature",
    relativeFilePath: "features/login.feature",
    scenarioName: "User logs in with valid credentials",
    scenarioLine: 10,
    status: "passed",
    durationMs: 1450,
    timestamp: Date.now() - 5000,
    capsFile: "configs/android_caps_v1.json",
    totalSteps: 3,
    passedSteps: 3,
    failedSteps: 0,
    steps: [
      { keyword: "Given", text: "user is on login page", status: "passed" },
      { keyword: "When", text: "user enters credentials", status: "passed" },
      { keyword: "Then", text: "dashboard is shown", status: "passed" }
    ]
  });

  behaveResultsManager.recordScenario({
    featureName: "Checkout Feature",
    featureFilePath: "/workspace/features/checkout.feature",
    relativeFilePath: "features/checkout.feature",
    scenarioName: "Payment card fails",
    scenarioLine: 25,
    status: "failed",
    durationMs: 2300,
    timestamp: Date.now(),
    capsFile: "configs/android_caps_v1.json",
    errorMessage: "AssertionError: Payment card declined",
    totalSteps: 2,
    passedSteps: 1,
    failedSteps: 1,
    steps: [
      { keyword: "Given", text: "user has cart items", status: "passed" },
      { keyword: "When", text: "user pays with expired card", status: "failed", error: "Card declined" }
    ]
  });

  const records = behaveResultsManager.getRecords("date_desc");
  assert(records.length === 2, "behaveResultsManager has 2 records");
  assert(records[0].scenarioName === "Payment card fails", "Most recent record is Payment card fails");
  const summary = behaveResultsManager.getSummary();
  assert(summary.total === 2, "Summary total is 2");
  assert(summary.passed === 1, "Summary passed is 1");
  assert(summary.failed === 1, "Summary failed is 1");

  // Verify Allure Report Generation produces report HTML
  const allureResult = await behaveResultsManager.generateAllureReport(path.resolve(__dirname, ".."));
  if (allureResult.missingCli) {
    assert(allureResult.success === false, "Returns success false when Allure CLI is missing");
    assert(allureResult.message.includes("Allure CLI was not found"), "Error message informs user of missing Allure CLI");
  } else {
    assert(allureResult.success === true, "Returns success true when Allure CLI is available");
  }
  assert(fs.existsSync(allureResult.reportPath), "Allure report index.html exists");
  const reportHtml = fs.readFileSync(allureResult.reportPath, "utf-8");
  assert(reportHtml.includes("Cucumber-Behave Test Execution & Allure Report"), "Report contains title");
  assert(reportHtml.includes("User logs in with valid credentials"), "Report contains passed scenario");
  assert(reportHtml.includes("Payment card fails"), "Report contains failed scenario");

  // Verify missing Allure CLI error behavior explicitly
  const origPath = process.env.PATH;
  try {
    process.env.PATH = ""; // Temporarily empty PATH to simulate missing Allure CLI
    const missingCliResult = await behaveResultsManager.generateAllureReport(path.resolve(__dirname, ".."));
    assert(missingCliResult.success === false, "Missing Allure CLI returns success: false");
    assert(missingCliResult.missingCli === true, "Missing Allure CLI sets missingCli: true");
    assert(missingCliResult.message.includes("Allure CLI was not found in PATH"), "Missing Allure CLI message contains PATH error");
    assert(missingCliResult.message.includes("npm install -g allure-commandline@latest"), "Missing Allure CLI message includes install command");
  } finally {
    process.env.PATH = origPath;
  }

  // Verify Failure Screenshot & DOM Dump Capture and Linking in Allure Report
  console.log("\n--- Verifying Allure Report Failure Artifacts (Screenshot & DOM Dump) ---");
  const testScreenshotsDir = path.resolve(__dirname, "../reports/screenshots");
  const testDomDumpsDir = path.resolve(__dirname, "../reports/dom_dumps");
  fs.mkdirSync(testScreenshotsDir, { recursive: true });
  fs.mkdirSync(testDomDumpsDir, { recursive: true });

  const sampleShot = path.join(testScreenshotsDir, "Payment_card_fails_failure.png");
  const sampleDom = path.join(testDomDumpsDir, "Payment_card_fails_dom.html");
  fs.writeFileSync(sampleShot, "fake-png-content");
  fs.writeFileSync(sampleDom, "<html><body><div id='popup'>Finding Pop Up</div></body></html>");

  // Multi-scenario isolation check: record a second failed scenario
  const secondShot = path.join(testScreenshotsDir, "User_login_fails_failure.png");
  const secondDom = path.join(testDomDumpsDir, "User_login_fails_dom.html");
  fs.writeFileSync(secondShot, "fake-user-login-shot");
  fs.writeFileSync(secondDom, "<html><body><div id='login-error'>Invalid Credentials Error</div></body></html>");

  behaveResultsManager.recordScenario({
    featureName: "Authentication Feature",
    featureFilePath: path.resolve(__dirname, "../example/features/login.feature"),
    relativeFilePath: "features/login.feature",
    scenarioName: "User login fails",
    scenarioLine: 20,
    status: "failed",
    durationMs: 1200,
    timestamp: Date.now(),
    errorMessage: "Invalid credentials",
    totalSteps: 2,
    passedSteps: 1,
    failedSteps: 1,
    steps: [
      { keyword: "Given", text: "user is on login page", status: "passed", durationMs: 500 },
      { keyword: "When", text: "user enters invalid password", status: "failed", durationMs: 700, error: "Invalid credentials" }
    ]
  });

  const allureArtifactResult = await behaveResultsManager.generateAllureReport(path.resolve(__dirname, ".."));
  const artifactReportHtml = fs.readFileSync(allureArtifactResult.reportPath, "utf-8");
  assert(artifactReportHtml.includes("attachment-screenshot"), "Allure report captures and links failure screenshot");
  assert(artifactReportHtml.includes("Payment_card_fails_failure.png"), "Allure report displays screenshot filename");
  assert(artifactReportHtml.includes("attachment-dom"), "Allure report captures and links failure DOM dump");
  assert(artifactReportHtml.includes("Payment_card_fails_dom.html"), "Allure report displays DOM dump filename");
  assert(artifactReportHtml.includes("Finding Pop Up"), "Allure report embeds complete DOM content");

  // Verify single DOM option with expand/collapse view
  assert(artifactReportHtml.includes("View Complete DOM (Expand)"), "Allure report has single Complete DOM expand/collapse option");
  assert(artifactReportHtml.includes("toggleDomCollapse("), "Allure report has toggleDomCollapse function for expand/collapse");

  // Verify high-contrast text and background styling for DOM readability
  assert(artifactReportHtml.includes("#f0f6fc"), "Allure report DOM viewer uses high-contrast text color (#f0f6fc)");
  assert(artifactReportHtml.includes(".dom-section"), "Allure report has high-contrast .dom-section styling");
  assert(artifactReportHtml.includes("dom-tag"), "Allure report syntax highlights DOM tags with high contrast");
  assert(artifactReportHtml.includes("dom-attr"), "Allure report syntax highlights DOM attributes with high contrast");
  assert(artifactReportHtml.includes("dom-val"), "Allure report syntax highlights DOM values with high contrast");

  // Verify wrap/unwrap functionality and complete line visibility
  assert(artifactReportHtml.includes("toggleDomWrap("), "Allure report has toggleDomWrap function for wrap toggle");
  assert(artifactReportHtml.includes("pre-wrap"), "DOM code view wraps by default for complete line visibility");
  assert(artifactReportHtml.includes("wrap-label"), "Wrap button updates text label on toggle");

  // Verify DOM is displayed within report only (no external tab navigation for full DOM)
  assert(!artifactReportHtml.includes("Open Full DOM Dump"), "Full DOM is displayed within report only, not external links");

  // Verify instance isolation: Each test record only contains its own execution artifacts
  const currentRecords = behaveResultsManager.getRecords();
  const paymentRecord = currentRecords.find((r) => r.scenarioName === "Payment card fails");
  const loginRecord = currentRecords.find((r) => r.scenarioName === "User login fails");
  assert(paymentRecord && paymentRecord.artifacts && paymentRecord.artifacts.length > 0, "Payment record has artifacts");
  assert(loginRecord && loginRecord.artifacts && loginRecord.artifacts.length > 0, "Login record has artifacts");
  assert(
    !paymentRecord.artifacts.some((a) => a.name.includes("User_login_fails")),
    "Payment record does NOT leak User login artifacts"
  );
  assert(
    !loginRecord.artifacts.some((a) => a.name.includes("Payment_card_fails")),
    "Login record does NOT leak Payment card artifacts"
  );

  console.log("ALL ALLURE FAILURE ARTIFACT (SCREENSHOT & DOM DUMP) CHECKS PASSED!");

  // Clean up reports dir generated during test
  const tmpReportsDir = path.resolve(__dirname, "../reports");
  if (fs.existsSync(tmpReportsDir)) {
    fs.rmSync(tmpReportsDir, { recursive: true, force: true });
  }

  // 22. Verify Caps Dropdown, Feature Discovery & Main Screen Execution Logs / Results
  console.log("\n--- Verifying Caps Dropdown, Feature Discovery & Main Screen Layout ---");
  const panelHtml = fs.readFileSync(path.resolve(__dirname, "../media/liveRunPanel.html"), "utf-8");
  assert(!panelHtml.includes("BEHAVE_RUN_SCRIPT_PLACEHOLDER"), "BEHAVE_RUN_SCRIPT_PLACEHOLDER removed to prevent VS Code API acquisition conflict");
  assert(panelHtml.includes('id="discoveryScanStatus"'), "Discovery scan status indicator exists");
  assert(panelHtml.includes('id="mainScreenLogsSection"'), "Main screen execution logs & results section exists on Discovery screen");
  assert(panelHtml.includes('id="mainConsoleOut"'), "Main screen execution logs console exists");
  assert(panelHtml.includes('id="openMainScreenBtn"'), "Open on Main Screen button exists");
  assert(panelHtml.includes('id="discoveryCapsSelect"'), "Discovery caps dropdown exists");
  assert(panelHtml.includes("Default Config (Auto-detect)"), "Caps dropdown has Default Config auto-detect option");
  assert(panelHtml.includes("startExecution("), "startExecution helper handles elected feature/scenario execution");

  // Verify detectConfigFiles finds all config files in workspace
  const detectedCaps = detectConfigFiles(path.resolve(__dirname, ".."));
  assert(detectedCaps.length >= 3, `detectConfigFiles found at least 3 caps files (actual: ${detectedCaps.length})`);
  assert(detectedCaps.some((f) => f.includes("android_caps_v1.json")), "android_caps_v1.json detected");
  assert(detectedCaps.some((f) => f.includes("ios_caps_v5.json")), "ios_caps_v5.json detected");
  assert(detectedCaps.some((f) => f.includes("config.properties")), "config.properties detected");

  // Verify command registration in package.json
  const hasMainScreenCmd = pkgContent.contributes.commands.some(
    (c: any) => c.command === "smartBehave.openMainScreen"
  );
  assert(hasMainScreenCmd, "smartBehave.openMainScreen command contributed in package.json");

  // Verify extension icon exists and is associated with Main Editor Area tabs
  assert(fs.existsSync(path.resolve(__dirname, "../data/logo.png")), "data/logo.png extension icon exists");
  const liveRunWebviewSource = fs.readFileSync(path.resolve(__dirname, "../src/ui/liveRunWebview.ts"), "utf-8");
  assert(
    liveRunWebviewSource.includes("CucumberBehaveMainScreenPanel") &&
      liveRunWebviewSource.includes("panel.iconPath = fs.existsSync(logoPngPath)"),
    "CucumberBehaveMainScreenPanel associates extension icon with editor tab"
  );
  assert(
    liveRunWebviewSource.includes("AllureReportPanel") &&
      liveRunWebviewSource.includes("panel.iconPath = fs.existsSync(logoPngPath)"),
    "AllureReportPanel associates extension icon with editor tab"
  );
  const configWebviewSource = fs.readFileSync(path.resolve(__dirname, "../src/ui/configWebview.ts"), "utf-8");
  assert(
    configWebviewSource.includes("SmartBehaveConfigPanel") &&
      configWebviewSource.includes("panel.iconPath = fs.existsSync(logoPngPath)"),
    "SmartBehaveConfigPanel associates extension icon with editor tab"
  );

  console.log("ALL CAPS DROPDOWN, FEATURE DISCOVERY & MAIN SCREEN VERIFICATION CHECKS PASSED!");
  console.log("ALL ACTIVITY BAR, 3-TAB & ALLURE VERIFICATION CHECKS PASSED!");
  console.log("ALL MAIN EDITOR AREA TAB EXTENSION ICON CHECKS PASSED!");
});
