import * as vscode from "vscode";
import { computeFeatureFormatLineEdits } from "../core/featureFormat";

export class BehaveFormattingProvider
  implements
    vscode.DocumentFormattingEditProvider,
    vscode.DocumentRangeFormattingEditProvider
{
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const lines = document.getText().split(/\r?\n/);
    if (lines.length === 0) {
      return [];
    }

    const edits = computeFeatureFormatLineEdits(lines, 0, lines.length - 1, {
      insertSpaces: options.insertSpaces,
      tabSize: options.tabSize,
    });

    return edits.map((e) => {
      const len = lines[e.line]?.length ?? 0;
      return vscode.TextEdit.replace(
        new vscode.Range(e.line, 0, e.line, len),
        e.newText
      );
    });
  }

  provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const lines = document.getText().split(/\r?\n/);
    const start = range.start.line;
    const end = range.end.line;

    const edits = computeFeatureFormatLineEdits(lines, start, end, {
      insertSpaces: options.insertSpaces,
      tabSize: options.tabSize,
    });

    return edits.map((e) => {
      const len = lines[e.line]?.length ?? 0;
      return vscode.TextEdit.replace(
        new vscode.Range(e.line, 0, e.line, len),
        e.newText
      );
    });
  }
}
