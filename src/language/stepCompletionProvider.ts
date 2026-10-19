import * as path from "path";
import * as vscode from "vscode";
import { parseStepLinePrefixForCompletion } from "../core/stepMatcher";
import { StepDefinition, StepKeyword } from "../core/types";
import { stepDefinitionIndex } from "./stepIndex";

function behavePatternToSnippet(pattern: string): string {
  let snippetIndex = 1;
  return pattern.replace(/\{(\w*)(?::\w)?\}/g, (_, name: string) => {
    return `\${${snippetIndex++}:${name || "param"}}`;
  });
}

function filterDefinitionsByKeyword(
  definitions: StepDefinition[],
  effectiveKeyword: StepKeyword | null
): StepDefinition[] {
  if (!effectiveKeyword) {
    return definitions;
  }
  return definitions.filter(
    (def) => def.keyword === "step" || def.keyword === effectiveKeyword
  );
}

export class BehaveCompletionItemProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const lineText = document.lineAt(position.line).text;
    const docLines = document.getText().split(/\r?\n/);

    const parsed = parseStepLinePrefixForCompletion(
      lineText,
      docLines,
      position.line
    );
    if (!parsed) {
      return [];
    }

    const { partialText, keywordEnd, effectiveKeyword } = parsed;
    const allDefinitions = stepDefinitionIndex.getDefinitions();
    const filtered = filterDefinitionsByKeyword(allDefinitions, effectiveKeyword);
    const lowerPartial = partialText.toLowerCase().trim();

    const matching = lowerPartial
      ? filtered.filter((def) =>
          def.pattern.toLowerCase().includes(lowerPartial)
        )
      : filtered;

    const sorted = [...matching].sort((a, b) => {
      const aLower = a.pattern.toLowerCase();
      const bLower = b.pattern.toLowerCase();
      const aStarts = aLower.startsWith(lowerPartial);
      const bStarts = bLower.startsWith(lowerPartial);
      if (aStarts && !bStarts) {
        return -1;
      }
      if (!aStarts && bStarts) {
        return 1;
      }
      return aLower.localeCompare(bLower);
    });

    const seenPatterns = new Set<string>();
    const unique: StepDefinition[] = [];
    for (const def of sorted) {
      if (!seenPatterns.has(def.pattern)) {
        seenPatterns.add(def.pattern);
        unique.push(def);
      }
    }

    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const workspacePath = folder?.uri.fsPath;

    const items: vscode.CompletionItem[] = [];
    for (let i = 0; i < unique.length; i++) {
      const def = unique[i];
      const snippetText = behavePatternToSnippet(def.pattern);
      const relativePath = workspacePath
        ? path.relative(workspacePath, def.filePath)
        : path.basename(def.filePath);

      const item = new vscode.CompletionItem(def.pattern, vscode.CompletionItemKind.Snippet);
      item.insertText = new vscode.SnippetString(snippetText);
      item.detail = `${def.keyword} step`;
      item.documentation = new vscode.MarkdownString(
        `Defined in [${relativePath}:${def.line + 1}](${vscode.Uri.file(def.filePath).toString()}#L${def.line + 1})`
      );
      item.sortText = String(i).padStart(5, "0");
      item.range = new vscode.Range(
        position.line,
        keywordEnd,
        position.line,
        lineText.length
      );

      items.push(item);
    }

    return items;
  }
}
