import * as fs from "fs/promises";
import * as vscode from "vscode";
import { behavePatternToRegex } from "../core/stepMatcher";
import { extractFeatureStepsFromContent } from "../core/featureSteps";
import { FeatureStep, StepKeyword } from "../core/types";
import { settings } from "../settings";

export class FeatureStepIndex {
  private steps: FeatureStep[] = [];
  private regexCache = new Map<string, RegExp>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  getSteps(): FeatureStep[] {
    return this.steps;
  }

  findMatchingSteps(pattern: string, keyword?: StepKeyword): FeatureStep[] {
    let regex = this.regexCache.get(pattern);
    if (!regex) {
      regex = behavePatternToRegex(pattern);
      this.regexCache.set(pattern, regex);
    }

    return this.steps.filter((step) => {
      if (keyword && keyword !== "step") {
        if (step.effectiveKeyword !== keyword) {
          return false;
        }
      }
      return regex!.test(step.text.trim());
    });
  }

  async rebuild(): Promise<void> {
    this.regexCache.clear();
    const next: FeatureStep[] = [];
    const seenFiles = new Set<string>();
    const patterns = settings.featureFilesPatterns() || ["**/*.feature"];

    for (const pattern of patterns) {
      const uris = await vscode.workspace.findFiles(pattern, "**/node_modules/**");
      for (const uri of uris) {
        const filePath = uri.fsPath;
        if (!filePath.endsWith(".feature") || seenFiles.has(filePath)) {
          continue;
        }
        seenFiles.add(filePath);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          next.push(...extractFeatureStepsFromContent(filePath, content));
        } catch {
          // skip
        }
      }
    }

    this.steps = next;
    this._onDidChange.fire();
  }

  registerWatcher(context: vscode.ExtensionContext): void {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.feature");
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

export const featureStepIndex = new FeatureStepIndex();
