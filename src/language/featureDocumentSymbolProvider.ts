import * as vscode from "vscode";

const FEATURE_REGEX = /^\s*Feature:\s*(.*)$/i;
const RULE_REGEX = /^\s*Rule:\s*(.*)$/i;
const BACKGROUND_REGEX = /^\s*Background:\s*(.*)$/i;
const SCENARIO_REGEX = /^\s*Scenario(?:\s+Outline)?:\s*(.*)$/i;
const EXAMPLES_REGEX = /^\s*Examples:\s*(.*)$/i;
const STEP_REGEX = /^\s*(Given|When|Then|And|But|\*)\s+(.*)$/i;

interface SectionNode {
  kind: "feature" | "rule" | "background" | "scenario" | "examples";
  symbol: vscode.DocumentSymbol;
  startLine: number;
}

export class BehaveDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const symbols: vscode.DocumentSymbol[] = [];
    const lineCount = document.lineCount;
    if (lineCount === 0) {
      return symbols;
    }

    let currentFeature: SectionNode | null = null;
    let currentRule: SectionNode | null = null;
    let currentScenarioOrBg: SectionNode | null = null;
    let currentExamples: SectionNode | null = null;

    const closeNode = (node: SectionNode | null, endLine: number) => {
      if (!node) return;
      const start = node.symbol.range.start;
      const end = document.lineAt(Math.max(start.line, endLine)).range.end;
      node.symbol.range = new vscode.Range(start, end);
    };

    for (let i = 0; i < lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text;

      // 1. Feature
      const featMatch = FEATURE_REGEX.exec(text);
      if (featMatch) {
        if (currentExamples) {
          closeNode(currentExamples, i - 1);
          currentExamples = null;
        }
        if (currentScenarioOrBg) {
          closeNode(currentScenarioOrBg, i - 1);
          currentScenarioOrBg = null;
        }
        if (currentRule) {
          closeNode(currentRule, i - 1);
          currentRule = null;
        }
        if (currentFeature) {
          closeNode(currentFeature, i - 1);
          currentFeature = null;
        }

        const title = featMatch[1]?.trim() || "Feature";
        const sym = new vscode.DocumentSymbol(
          title,
          "Feature",
          vscode.SymbolKind.Package,
          line.range,
          line.range
        );
        symbols.push(sym);
        currentFeature = { kind: "feature", symbol: sym, startLine: i };
        continue;
      }

      // 2. Rule
      const ruleMatch = RULE_REGEX.exec(text);
      if (ruleMatch) {
        if (currentExamples) {
          closeNode(currentExamples, i - 1);
          currentExamples = null;
        }
        if (currentScenarioOrBg) {
          closeNode(currentScenarioOrBg, i - 1);
          currentScenarioOrBg = null;
        }
        if (currentRule) {
          closeNode(currentRule, i - 1);
          currentRule = null;
        }

        const title = ruleMatch[1]?.trim() || "Rule";
        const sym = new vscode.DocumentSymbol(
          title,
          "Rule",
          vscode.SymbolKind.Namespace,
          line.range,
          line.range
        );
        if (currentFeature) {
          currentFeature.symbol.children.push(sym);
        } else {
          symbols.push(sym);
        }
        currentRule = { kind: "rule", symbol: sym, startLine: i };
        continue;
      }

      // 3. Background
      const bgMatch = BACKGROUND_REGEX.exec(text);
      if (bgMatch) {
        if (currentExamples) {
          closeNode(currentExamples, i - 1);
          currentExamples = null;
        }
        if (currentScenarioOrBg) {
          closeNode(currentScenarioOrBg, i - 1);
          currentScenarioOrBg = null;
        }

        const title = bgMatch[1]?.trim() || "Background";
        const sym = new vscode.DocumentSymbol(
          title,
          "Background",
          vscode.SymbolKind.Constructor,
          line.range,
          line.range
        );
        const parent = currentRule ?? currentFeature;
        if (parent) {
          parent.symbol.children.push(sym);
        } else {
          symbols.push(sym);
        }
        currentScenarioOrBg = { kind: "background", symbol: sym, startLine: i };
        continue;
      }

      // 4. Scenario or Scenario Outline
      const scenMatch = SCENARIO_REGEX.exec(text);
      if (scenMatch) {
        if (currentExamples) {
          closeNode(currentExamples, i - 1);
          currentExamples = null;
        }
        if (currentScenarioOrBg) {
          closeNode(currentScenarioOrBg, i - 1);
          currentScenarioOrBg = null;
        }

        const isOutline = /scenario\s+outline/i.test(text);
        const title = scenMatch[1]?.trim() || (isOutline ? "Scenario Outline" : "Scenario");
        const sym = new vscode.DocumentSymbol(
          title,
          isOutline ? "Scenario Outline" : "Scenario",
          vscode.SymbolKind.Method,
          line.range,
          line.range
        );
        const parent = currentRule ?? currentFeature;
        if (parent) {
          parent.symbol.children.push(sym);
        } else {
          symbols.push(sym);
        }
        currentScenarioOrBg = { kind: "scenario", symbol: sym, startLine: i };
        continue;
      }

      // 5. Examples table header
      const exMatch = EXAMPLES_REGEX.exec(text);
      if (exMatch) {
        if (currentExamples) {
          closeNode(currentExamples, i - 1);
          currentExamples = null;
        }

        const title = exMatch[1]?.trim() || "Examples";
        const sym = new vscode.DocumentSymbol(
          title,
          "Examples",
          vscode.SymbolKind.Struct,
          line.range,
          line.range
        );
        if (currentScenarioOrBg) {
          currentScenarioOrBg.symbol.children.push(sym);
        } else {
          symbols.push(sym);
        }
        currentExamples = { kind: "examples", symbol: sym, startLine: i };
        continue;
      }

      // 6. Step line (Given/When/Then/And/But/*)
      const stepMatch = STEP_REGEX.exec(text);
      if (stepMatch && currentScenarioOrBg) {
        const kw = stepMatch[1];
        const stepText = stepMatch[2].trim();
        const sym = new vscode.DocumentSymbol(
          `${kw} ${stepText}`,
          kw,
          vscode.SymbolKind.Function,
          line.range,
          line.range
        );
        currentScenarioOrBg.symbol.children.push(sym);
      }
    }

    // Close any unclosed sections at EOF
    if (currentExamples) closeNode(currentExamples, lineCount - 1);
    if (currentScenarioOrBg) closeNode(currentScenarioOrBg, lineCount - 1);
    if (currentRule) closeNode(currentRule, lineCount - 1);
    if (currentFeature) closeNode(currentFeature, lineCount - 1);

    return symbols;
  }
}
