import * as vscode from "vscode";
import { computeFeatureFormatLineEdits } from "../core/featureFormat";

export class BehaveFormattingProvider
  implements
    vscode.DocumentFormattingEditProvider,
    vscode.DocumentRangeFormattingEditProvider,
    vscode.OnTypeFormattingEditProvider
{
  provideOnTypeFormattingEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    ch: string,
    options: vscode.FormattingOptions,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    if (ch !== "|") {
      return [];
    }

    const currentLine = document.lineAt(position.line).text;
    if (!/^\s*\|/.test(currentLine)) {
      return [];
    }

    // Find the bounds of the contiguous table block around the cursor
    let startLine = position.line;
    while (startLine > 0 && /^\s*\|/.test(document.lineAt(startLine - 1).text)) {
      startLine--;
    }

    let endLine = position.line;
    while (
      endLine < document.lineCount - 1 &&
      /^\s*\|/.test(document.lineAt(endLine + 1).text)
    ) {
      endLine++;
    }

    const lines = document.getText().split(/\r?\n/);
    const edits = computeFeatureFormatLineEdits(lines, startLine, endLine, {
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
