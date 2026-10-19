import * as vscode from "vscode";
import { parseFeatureFile } from "./core";
import {
  getFeatureHierarchyNodeForPath,
  getScenarioNodeAtLine,
  getScenarioOutlineExpansionNodes
} from "./run/behaveHierarchyQueries";
import {
  runBehaveHierarchyDebugSelection,
  runBehaveHierarchySelection
} from "./run/behaveRunExecution";
import {
  subscribeBehaveHierarchyChanges,
  type BehaveHierarchyStore
} from "./run/behaveHierarchyModel";
import { settings } from "./settings";

function lineRange(doc: vscode.TextDocument, line0: number): vscode.Range {
  const line = doc.lineAt(line0);
  return new vscode.Range(line0, 0, line0, line.text.length);
}

class BehaveCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    if (!settings.codeLens()) {
      return [];
    }
    if (
      document.languageId !== "behave" &&
      document.languageId !== "feature" &&
      document.languageId !== "gherkin" &&
      !document.fileName.endsWith(".feature")
    ) {
      return [];
    }

    const text = document.getText();
    const parsed = parseFeatureFile(document.uri.fsPath, text);
    const fsPath = document.uri.fsPath;
    const lenses: vscode.CodeLens[] = [];

    const featureRange = lineRange(document, parsed.line);
    lenses.push(
      new vscode.CodeLens(featureRange, {
        title: "$(play) Run",
        command: "behave.editor.runFeature",
        arguments: [fsPath]
      }),
      new vscode.CodeLens(featureRange, {
        title: "$(debug-alt) Debug",
        command: "behave.editor.debugFeature",
        arguments: [fsPath]
      })
    );

    for (const sc of parsed.scenarios) {
      if (sc.isOutline && sc.outlineExpansions && sc.outlineExpansions.length > 0) {
        const outlineR = lineRange(document, sc.line);
        lenses.push(
          new vscode.CodeLens(outlineR, {
            title: "$(play) Run all",
            command: "behave.editor.runScenarioOutline",
            arguments: [fsPath, sc.line]
          }),
          new vscode.CodeLens(outlineR, {
            title: "$(debug-alt) Debug all",
            command: "behave.editor.debugScenarioOutline",
            arguments: [fsPath, sc.line]
          })
        );
        for (const ex of sc.outlineExpansions) {
          const er = lineRange(document, ex.line);
          lenses.push(
            new vscode.CodeLens(er, {
              title: "$(play) Run",
              command: "behave.editor.runScenario",
              arguments: [fsPath, ex.line]
            }),
            new vscode.CodeLens(er, {
              title: "$(debug-alt) Debug",
              command: "behave.editor.debugScenario",
              arguments: [fsPath, ex.line]
            })
          );
        }
      } else {
        const r = lineRange(document, sc.line);
        lenses.push(
          new vscode.CodeLens(r, {
            title: "$(play) Run",
            command: "behave.editor.runScenario",
            arguments: [fsPath, sc.line]
          }),
          new vscode.CodeLens(r, {
            title: "$(debug-alt) Debug",
            command: "behave.editor.debugScenario",
            arguments: [fsPath, sc.line]
          })
        );
      }
    }

    return lenses;
  }
}

export function registerBehaveCodeLens(
  context: vscode.ExtensionContext,
  store: BehaveHierarchyStore
): void {
  const selector: vscode.DocumentSelector = [
    { language: "behave", scheme: "file" },
    { language: "feature", scheme: "file" },
    { language: "gherkin", scheme: "file" },
    { pattern: "**/*.feature" }
  ];

  const codeLensProvider = new BehaveCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(selector, codeLensProvider),
    subscribeBehaveHierarchyChanges(() => codeLensProvider.refresh())
  );

  const runFeature = async (fsPath: string): Promise<void> => {
    const node = await getFeatureHierarchyNodeForPath(store, fsPath);
    if (!node) {
      void vscode.window.showErrorMessage(
        "Behave: could not resolve this feature file (open a workspace folder that contains it)."
      );
      return;
    }
    const cts = new vscode.CancellationTokenSource();
    try {
      await runBehaveHierarchySelection([node], cts.token);
    } finally {
      cts.dispose();
    }
  };

  const debugFeature = async (fsPath: string): Promise<void> => {
    const node = await getFeatureHierarchyNodeForPath(store, fsPath);
    if (!node) {
      void vscode.window.showErrorMessage(
        "Behave: could not resolve this feature file (open a workspace folder that contains it)."
      );
      return;
    }
    const cts = new vscode.CancellationTokenSource();
    try {
      await runBehaveHierarchyDebugSelection([node], cts.token);
    } finally {
      cts.dispose();
    }
  };

  const runScenario = async (
    fsPath: string,
    scenarioLine: number
  ): Promise<void> => {
    const node = await getScenarioNodeAtLine(store, fsPath, scenarioLine);
    if (!node) {
      void vscode.window.showErrorMessage(
        "Behave: could not resolve scenario at this line."
      );
      return;
    }
    const cts = new vscode.CancellationTokenSource();
    try {
      await runBehaveHierarchySelection([node], cts.token);
    } finally {
      cts.dispose();
    }
  };

  const debugScenario = async (
    fsPath: string,
    scenarioLine: number
  ): Promise<void> => {
    const node = await getScenarioNodeAtLine(store, fsPath, scenarioLine);
    if (!node) {
      void vscode.window.showErrorMessage(
        "Behave: could not resolve scenario at this line."
      );
      return;
    }
    const cts = new vscode.CancellationTokenSource();
    try {
      await runBehaveHierarchyDebugSelection([node], cts.token);
    } finally {
      cts.dispose();
    }
  };

  const runScenarioOutline = async (
    fsPath: string,
    outlineHeaderLine: number
  ): Promise<void> => {
    const nodes = await getScenarioOutlineExpansionNodes(
      store,
      fsPath,
      outlineHeaderLine
    );
    if (nodes.length === 0) {
      void vscode.window.showErrorMessage(
        "Behave: no example rows found for this Scenario Outline."
      );
      return;
    }
    const cts = new vscode.CancellationTokenSource();
    try {
      await runBehaveHierarchySelection(nodes, cts.token);
    } finally {
      cts.dispose();
    }
  };

  const debugScenarioOutline = async (
    fsPath: string,
    outlineHeaderLine: number
  ): Promise<void> => {
    const nodes = await getScenarioOutlineExpansionNodes(
      store,
      fsPath,
      outlineHeaderLine
    );
    if (nodes.length === 0) {
      void vscode.window.showErrorMessage(
        "Behave: no example rows found for this Scenario Outline."
      );
      return;
    }
    const cts = new vscode.CancellationTokenSource();
    try {
      await runBehaveHierarchyDebugSelection(nodes, cts.token);
    } finally {
      cts.dispose();
    }
  };

  // Register both behave.editor.* and behaveRunner.editor.*
  const commandsToRegister = [
    { name: "behave.editor.runFeature", fn: runFeature },
    { name: "behaveRunner.editor.runFeature", fn: runFeature },
    { name: "behave.editor.debugFeature", fn: debugFeature },
    { name: "behaveRunner.editor.debugFeature", fn: debugFeature },
    { name: "behave.editor.runScenario", fn: runScenario },
    { name: "behaveRunner.editor.runScenario", fn: runScenario },
    { name: "behave.editor.debugScenario", fn: debugScenario },
    { name: "behaveRunner.editor.debugScenario", fn: debugScenario },
    { name: "behave.editor.runScenarioOutline", fn: runScenarioOutline },
    { name: "behaveRunner.editor.runScenarioOutline", fn: runScenarioOutline },
    { name: "behave.editor.debugScenarioOutline", fn: debugScenarioOutline },
    { name: "behaveRunner.editor.debugScenarioOutline", fn: debugScenarioOutline },
  ];

  for (const cmd of commandsToRegister) {
    context.subscriptions.push(vscode.commands.registerCommand(cmd.name, cmd.fn));
  }
}
