import * as fs from "fs";
import * as path from "path";
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

console.log("\nALL VERIFICATION CHECKS PASSED!");
