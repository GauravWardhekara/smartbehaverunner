import * as vscode from "vscode";
import { computeFeatureFormatLineEdits, FeatureFormatOptions } from "../core/featureFormat";
import { settings } from "../settings";

function getFormatOptions(
  document: vscode.TextDocument,
  options: vscode.FormattingOptions
): FeatureFormatOptions {
  const uri = document.uri;
  return {
    insertSpaces: options.insertSpaces,
    tabSize: options.tabSize,
    customIndent: {
      enabled: settings.formatting.customIndentEnabled(uri),
      indentCharacter: settings.formatting.indentCharacter(uri) as any,
      feature: settings.formatting.indentFeature(uri),
      scenario: settings.formatting.indentScenario(uri),
      background: settings.formatting.indentBackground(uri),
      rule: settings.formatting.indentRule(uri),
      examples: settings.formatting.indentExamples(uri),
      given: settings.formatting.indentGiven(uri),
      when: settings.formatting.indentWhen(uri),
      then: settings.formatting.indentThen(uri),
      and: settings.formatting.indentAnd(uri),
      but: settings.formatting.indentBut(uri),
      star: settings.formatting.indentStar(uri),
      relativeAnd: settings.formatting.relativeAnd(uri),
    },
  };
}

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
    const formatOpts = getFormatOptions(document, options);
    const edits = computeFeatureFormatLineEdits(lines, startLine, endLine, formatOpts);

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

    const formatOpts = getFormatOptions(document, options);
    const edits = computeFeatureFormatLineEdits(lines, 0, lines.length - 1, formatOpts);

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

    const formatOpts = getFormatOptions(document, options);
    const edits = computeFeatureFormatLineEdits(lines, start, end, formatOpts);

    return edits.map((e) => {
      const len = lines[e.line]?.length ?? 0;
      return vscode.TextEdit.replace(
        new vscode.Range(e.line, 0, e.line, len),
        e.newText
      );
    });
  }
}
