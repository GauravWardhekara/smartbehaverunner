import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { parseStepLine } from "../core/stepMatcher";
import { StepKeyword } from "../core/types";
import { generateStepSnippet, GeneratedStepSnippet } from "../core/stepSnippetGenerator";
import { LOG } from "../log";

export { generateStepSnippet, GeneratedStepSnippet };

export class BehaveCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
    // Only trigger for .feature files
    if (document.languageId !== "feature" && !document.fileName.endsWith(".feature")) {
      return [];
    }

    const undefinedDiag = context.diagnostics.find(
      (d) => d.code === "undefined-step" || (typeof d.code === "string" && d.code.includes("undefined"))
    );

    const lineText = document.lineAt(range.start.line).text;
    const parsed = parseStepLine(lineText);
    if (!parsed) {
      return [];
    }

    const effectiveKeyword = parsed.effectiveKeyword ?? (parsed.keyword.toLowerCase() as StepKeyword);
    const snippet = generateStepSnippet(effectiveKeyword, parsed.text);

    const actions: vscode.CodeAction[] = [];

    // Action 1: Generate step definition in Python file
    const genAction = new vscode.CodeAction(
      `Smart Behave: Generate step definition for "${parsed.text}"`,
      vscode.CodeActionKind.QuickFix
    );
    genAction.command = {
      command: "smartBehave.generateStepDefinition",
      title: "Generate Step Definition",
      arguments: [document.uri, snippet],
    };
    genAction.isPreferred = !!undefinedDiag;
    if (undefinedDiag) {
      genAction.diagnostics = [undefinedDiag];
    }
    actions.push(genAction);

    // Action 2: Copy step definition snippet to clipboard
    const copyAction = new vscode.CodeAction(
      `Smart Behave: Copy step definition snippet to clipboard`,
      vscode.CodeActionKind.QuickFix
    );
    copyAction.command = {
      command: "smartBehave.copyStepSnippet",
      title: "Copy Step Definition Snippet",
      arguments: [snippet.code],
    };
    if (undefinedDiag) {
      copyAction.diagnostics = [undefinedDiag];
    }
    actions.push(copyAction);

    return actions;
  }
}

/**
 * Handles generating and inserting a step definition into a Python file.
 */
export async function executeGenerateStepDefinition(
  featureUri: vscode.Uri,
  snippet: GeneratedStepSnippet
): Promise<void> {
  try {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(featureUri);
    const rootPath = workspaceFolder?.uri.fsPath ?? path.dirname(featureUri.fsPath);

    // Look for existing step files
    const stepFiles = await vscode.workspace.findFiles("**/steps/**/*.py", "**/node_modules/**");

    let targetFilePath: string;

    if (stepFiles.length === 1) {
      targetFilePath = stepFiles[0].fsPath;
    } else if (stepFiles.length > 1) {
      // Present QuickPick
      type StepPick = vscode.QuickPickItem & { fsPath?: string; isNew?: boolean };
      const picks: StepPick[] = stepFiles.map((f) => ({
        label: path.basename(f.fsPath),
        description: vscode.workspace.asRelativePath(f),
        fsPath: f.fsPath,
      }));
      picks.push({
        label: "$(plus) Create new step file...",
        description: "Create a new Python file in features/steps/",
        isNew: true,
      });

      const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: "Select a Python step definition file to add the step to",
      });

      if (!selected) {
        return;
      }

      if (selected.isNew) {
        const inputName = await vscode.window.showInputBox({
          prompt: "Enter file name (e.g. custom_steps.py)",
          value: "steps.py",
        });
        if (!inputName) return;
        const dir = path.join(rootPath, "features", "steps");
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        targetFilePath = path.join(dir, inputName.endsWith(".py") ? inputName : `${inputName}.py`);
      } else {
        targetFilePath = selected.fsPath!;
      }
    } else {
      // Default to features/steps/steps.py
      const dir = path.join(rootPath, "features", "steps");
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      targetFilePath = path.join(dir, "steps.py");
    }

    const fileExists = fs.existsSync(targetFilePath);
    let fileContent = fileExists ? fs.readFileSync(targetFilePath, "utf-8") : "";

    const hasImport =
      fileContent.includes("from behave import") ||
      fileContent.includes("import behave");

    let insertion = "";
    if (!fileExists || fileContent.trim().length === 0) {
      insertion = "from behave import given, when, then, step\n\n\n" + snippet.code + "\n";
    } else {
      const needsLeadingImport = !hasImport;
      const prefix = needsLeadingImport
        ? "from behave import given, when, then, step\n\n"
        : "";
      const separator = fileContent.endsWith("\n\n")
        ? ""
        : fileContent.endsWith("\n")
        ? "\n"
        : "\n\n";
      insertion = prefix + separator + snippet.code + "\n";
    }

    if (fileExists) {
      fs.appendFileSync(targetFilePath, insertion, "utf-8");
    } else {
      fs.writeFileSync(targetFilePath, insertion, "utf-8");
    }

    // Open target file and position cursor at new step
    const doc = await vscode.workspace.openTextDocument(targetFilePath);
    const editor = await vscode.window.showTextDocument(doc);
    const lineCount = doc.lineCount;
    const targetLine = Math.max(0, lineCount - 2);
    const pos = new vscode.Position(targetLine, 4);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

    vscode.window.showInformationMessage(
      `Generated step definition in ${path.basename(targetFilePath)}`
    );
  } catch (err) {
    LOG.error("Failed to generate step definition:", err);
    vscode.window.showErrorMessage(`Failed to generate step definition: ${err}`);
  }
}
