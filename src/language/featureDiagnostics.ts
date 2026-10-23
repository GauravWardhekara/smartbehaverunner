import * as vscode from "vscode";
import { analyzeFeatureDocument } from "../core/featureSemanticTokens";
import { stepDefinitionIndex } from "./stepIndex";

export class BehaveDiagnosticsManager {
  private diagnosticCollection: vscode.DiagnosticCollection;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection("behave");
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(this.diagnosticCollection);

    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "feature" || e.document.fileName.endsWith(".feature")) {
          this.updateDiagnostics(e.document);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === "feature" || doc.fileName.endsWith(".feature")) {
          this.updateDiagnostics(doc);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.diagnosticCollection.delete(doc.uri);
      })
    );

    stepDefinitionIndex.onDidChange(() => {
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === "feature" || doc.fileName.endsWith(".feature")) {
          this.updateDiagnostics(doc);
        }
      }
    });

    for (const doc of vscode.workspace.textDocuments) {
      if (doc.languageId === "feature" || doc.fileName.endsWith(".feature")) {
        this.updateDiagnostics(doc);
      }
    }
  }

  updateDiagnostics(document: vscode.TextDocument): void {
    const suppressDuplicates = vscode.workspace
      .getConfiguration("smartBehave")
      .get<boolean>("diagnostics.suppressDuplicateBehaveWarnings", true);
    if (suppressDuplicates) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const text = document.getText();
    const definitions = stepDefinitionIndex.getDefinitions();
    const analysis = analyzeFeatureDocument(text, definitions);

    const diagnostics: vscode.Diagnostic[] = analysis.undefinedStepDiagnostics.map((d) => {
      const range = new vscode.Range(d.line, d.startCharacter, d.line, d.endCharacter);
      const diagnostic = new vscode.Diagnostic(
        range,
        d.message,
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = "Behave";
      diagnostic.code = d.code;
      return diagnostic;
    });

    this.diagnosticCollection.set(document.uri, diagnostics);
  }
}

export const behaveDiagnosticsManager = new BehaveDiagnosticsManager();
