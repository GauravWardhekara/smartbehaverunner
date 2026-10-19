import * as vscode from "vscode";
import { findMatchingDefinitions, parseStepLine, resolveEffectiveKeyword } from "../core/stepMatcher";
import { StepKeyword } from "../core/types";
import { stepDefinitionIndex } from "./stepIndex";

export class BehaveDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    const lines = document.getText().split(/\r?\n/);
    const lineText = lines[position.line] ?? "";
    const effectiveKeyword = resolveEffectiveKeyword(lines, position.line);
    const stepInfo = parseStepLine(lineText, effectiveKeyword);
    if (!stepInfo) {
      return null;
    }

    const allDefinitions = stepDefinitionIndex.getDefinitions();
    const matchingDefs = findMatchingDefinitions(
      stepInfo.text,
      stepInfo.effectiveKeyword as StepKeyword | null,
      allDefinitions
    );

    if (matchingDefs.length === 0) {
      return null;
    }

    return matchingDefs.map((def) => {
      const targetUri = vscode.Uri.file(def.filePath);
      const targetPos = new vscode.Position(def.line, def.character);
      return new vscode.Location(targetUri, targetPos);
    });
  }
}
