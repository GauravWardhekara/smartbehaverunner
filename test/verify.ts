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

console.log("\nALL VERIFICATION CHECKS PASSED!");
