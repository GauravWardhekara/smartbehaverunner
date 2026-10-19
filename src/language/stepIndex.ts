import * as fs from "fs/promises";
import * as vscode from "vscode";
import { DEFAULT_STEP_DEFINITION_PATTERNS, parseStepDefinitionsFromPython } from "../core/pythonStepDecorators";
import { StepDefinition } from "../core/types";
import { settings } from "../settings";

export class StepDefinitionIndex {
  private definitions: StepDefinition[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  getDefinitions(): StepDefinition[] {
    return this.definitions;
  }

  async rebuild(): Promise<void> {
    const next: StepDefinition[] = [];
    const seenFiles = new Set<string>();
    const patterns = settings.stepDefinitionsPatterns() || DEFAULT_STEP_DEFINITION_PATTERNS;

    for (const pattern of patterns) {
      const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**");
      for (const uri of uris) {
        const filePath = uri.fsPath;
        if (seenFiles.has(filePath)) {
          continue;
        }
        seenFiles.add(filePath);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          next.push(...parseStepDefinitionsFromPython(filePath, content));
        } catch {
          // ignore unreadable files
        }
      }
    }

    this.definitions = next;
    this._onDidChange.fire();
  }

  registerWatcher(context: vscode.ExtensionContext): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.py");
    let timer: NodeJS.Timeout | undefined;

    const scheduleRebuild = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void this.rebuild();
      }, 250);
    };

    watcher.onDidChange(scheduleRebuild);
    watcher.onDidCreate(scheduleRebuild);
    watcher.onDidDelete(scheduleRebuild);

    context.subscriptions.push(watcher, {
      dispose: () => {
        clearTimeout(timer);
        this._onDidChange.dispose();
      },
    });

    void this.rebuild();
  }
}

export const stepDefinitionIndex = new StepDefinitionIndex();
