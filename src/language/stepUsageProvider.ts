import * as vscode from "vscode";
import {
  collectBehaveStepDecoratorsAboveFunction,
  isPythonFunctionDefinitionLine,
} from "../core/pythonStepDecoratorScan";
import { StepKeyword } from "../core/types";
import { featureStepIndex } from "./featureStepIndex";

export class BehaveStepUsageProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition> {
    const lines = document.getText().split(/\r?\n/);
    const line = lines[position.line];
    if (!line || !isPythonFunctionDefinitionLine(line)) {
      return null;
    }

    const decorators = collectBehaveStepDecoratorsAboveFunction(
      lines,
      position.line
    );
    if (decorators.length === 0) {
      return null;
    }

    const locs: vscode.Location[] = [];
    for (const { keyword, pattern } of decorators) {
      const matches = featureStepIndex.findMatchingSteps(
        pattern,
        keyword as StepKeyword
      );
      for (const step of matches) {
        locs.push(
          new vscode.Location(
            vscode.Uri.file(step.filePath),
            new vscode.Position(step.line, step.character)
          )
        );
      }
    }

    return locs.length > 0 ? locs : null;
  }
}
