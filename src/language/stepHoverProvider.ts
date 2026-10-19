import * as path from "path";
import * as vscode from "vscode";
import { findMatchingDefinitions, parseStepLine, resolveEffectiveKeyword } from "../core/stepMatcher";
import type { StepKeyword } from "../core/types";
import { stepDefinitionIndex } from "./stepIndex";

export class BehaveHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
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

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    if (matchingDefs.length > 0) {
      md.appendMarkdown(`### $(symbol-method) Behave Step Definition\n\n`);
      for (const def of matchingDefs) {
        md.appendCodeblock(
          `@${def.keyword}("${def.pattern}")`,
          "python"
        );
        const fileBase = path.basename(def.filePath);
        const lineNum = def.line + 1;
        const uri = vscode.Uri.file(def.filePath);
        md.appendMarkdown(
          `Defined in [${fileBase}:${lineNum}](${uri.toString()}#L${lineNum})\n\n`
        );
      }
    } else {
      md.appendMarkdown(`### $(warning) Undefined Step\n\n`);
      md.appendMarkdown(
        `No Python step definition found matching:\n\n> **${stepInfo.keyword}** ${stepInfo.text}\n\n`
      );
      md.appendMarkdown(
        `💡 Press **Ctrl+.** (Cmd+.) on this line to automatically generate the Python step snippet.`
      );
    }

    const startChar = lineText.indexOf(stepInfo.text);
    const endChar = startChar >= 0 ? startChar + stepInfo.text.length : lineText.length;
    const range = new vscode.Range(position.line, Math.max(0, startChar), position.line, endChar);

    return new vscode.Hover(md, range);
  }
}
