import * as vscode from "vscode";
import {
  computeFeatureSemanticTokenSpans,
  FeatureSemanticTokenKind,
  FeatureSemanticTokenSpan,
} from "../core/featureSemanticTokens";

export const BEHAVE_TOKEN_TYPES = [
  "behaveComment",
  "behaveStructuralKeyword",
  "behaveStepKeyword",
  "behaveTitle",
  "behaveStepText",
  "behaveDocstring",
  "behaveTable",
  "behavePlaceholder",
  "behaveTag",
] as const;

const KIND_TO_INDEX = new Map<FeatureSemanticTokenKind, number>([
  ["comment", 0],
  ["structuralKeyword", 1],
  ["stepKeyword", 2],
  ["title", 3],
  ["stepText", 4],
  ["docstring", 5],
  ["table", 6],
  ["placeholder", 7],
  ["tag", 8],
]);

export const BEHAVE_SEMANTIC_TOKEN_LEGEND = new vscode.SemanticTokensLegend(
  [...BEHAVE_TOKEN_TYPES]
);

function compareSpans(
  a: { line: number; start: number; length: number },
  b: { line: number; start: number; length: number }
): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  if (a.start !== b.start) {
    return a.start - b.start;
  }
  return b.length - a.length;
}

export class BehaveSemanticTokensProvider
  implements
    vscode.DocumentSemanticTokensProvider,
    vscode.DocumentRangeSemanticTokensProvider
{
  provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    const text = document.getText();
    const spans = computeFeatureSemanticTokenSpans(text);
    return this.buildTokens(spans);
  }

  provideDocumentRangeSemanticTokens(
    document: vscode.TextDocument,
    range: vscode.Range,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    const text = document.getText();
    const spans = computeFeatureSemanticTokenSpans(text).filter(
      (s) => s.line >= range.start.line && s.line <= range.end.line
    );
    return this.buildTokens(spans);
  }

  private buildTokens(spans: FeatureSemanticTokenSpan[]): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(BEHAVE_SEMANTIC_TOKEN_LEGEND);
    const sorted = [...spans].sort(compareSpans);

    for (const span of sorted) {
      const typeIndex = KIND_TO_INDEX.get(span.kind);
      if (typeIndex !== undefined) {
        builder.push(span.line, span.start, span.length, typeIndex, 0);
      }
    }

    return builder.build();
  }
}
