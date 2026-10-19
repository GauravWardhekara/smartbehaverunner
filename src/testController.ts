import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { parseFeatureFile, ParsedFeature, ParsedScenario, ParsedStep } from "./core";
import { LOG } from "./log";
import {
  getFeatureHierarchyNodeForPath,
  getScenarioNodeAtLine,
  getScenarioOutlineExpansionNodes
} from "./run/behaveHierarchyQueries";
import {
  runBehaveHierarchyDebugSelection,
  runBehaveHierarchySelection
} from "./run/behaveRunExecution";
import { BehaveHierarchyNode, type BehaveHierarchyStore } from "./run/behaveHierarchyModel";
import { settings } from "./settings";

export function createTestMessageFromError(errorText: string): vscode.TestMessage {
  const message = new vscode.TestMessage(errorText);
  const diffRegexes = settings.diffRegex() || [];
  for (const regex of diffRegexes) {
    try {
      const match = new RegExp(regex).exec(errorText);
      if (match?.groups) {
        message.expectedOutput = match.groups["expected"];
        message.actualOutput = match.groups["actual"];
        break;
      }
    } catch {
      // ignore regex match error
    }
  }
  return message;
}

export class BehaveTestControllerManager {
  private readonly controller: vscode.TestController;
  private hierarchyStore?: BehaveHierarchyStore;

  constructor() {
    this.controller = vscode.tests.createTestController("behave", "Behave");
  }

  getController(): vscode.TestController {
    return this.controller;
  }

  setHierarchyStore(store: BehaveHierarchyStore): void {
    this.hierarchyStore = store;
  }

  register(context: vscode.ExtensionContext, store: BehaveHierarchyStore): void {
    this.hierarchyStore = store;
    context.subscriptions.push(this.controller);

    this.controller.refreshHandler = async () => {
      await this.discoverAll();
    };

    const runProfile = this.controller.createRunProfile(
      "Run Behave Tests",
      vscode.TestRunProfileKind.Run,
      async (request, token) => {
        await this.handleTestRun(request, token, false);
      },
      true
    );

    const debugProfile = this.controller.createRunProfile(
      "Debug Behave Tests",
      vscode.TestRunProfileKind.Debug,
      async (request, token) => {
        await this.handleTestRun(request, token, true);
      },
      false
    );

    context.subscriptions.push(runProfile, debugProfile);
  }

  async loadFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = parseFeatureFile(filePath, content);
      this.syncFeatureToController(filePath, parsed, content);
    } catch (e) {
      LOG.error(`Failed to load feature file: ${filePath}`, e);
    }
  }

  unloadFile(filePath: string): void {
    const id = filePath;
    this.controller.items.delete(id);
  }

  async discoverAll(): Promise<void> {
    const pattern = settings.allowedFiles() || "**/*.feature";
    const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**");
    for (const file of files) {
      await this.loadFile(file.fsPath);
    }
  }

  private syncFeatureToController(
    filePath: string,
    parsed: ParsedFeature,
    content: string
  ): void {
    const uri = vscode.Uri.file(filePath);
    const basename = path.basename(filePath);
    const label = parsed.name ? `${basename} — ${parsed.name}` : basename;

    let featureItem = this.controller.items.get(filePath);
    if (!featureItem) {
      featureItem = this.controller.createTestItem(filePath, label, uri);
      this.controller.items.add(featureItem);
    } else {
      featureItem.label = label;
      featureItem.children.replace([]);
    }

    const lines = content.split(/\r?\n/);
    const featureLineLen = lines[parsed.line]?.length ?? 0;
    featureItem.range = new vscode.Range(parsed.line, 0, parsed.line, featureLineLen);

    for (const sc of parsed.scenarios) {
      if (sc.isOutline && sc.outlineExpansions && sc.outlineExpansions.length > 0) {
        const outlineId = `${filePath}:${sc.line}`;
        const outlineItem = this.controller.createTestItem(outlineId, sc.name, uri);
        const scLineLen = lines[sc.line]?.length ?? 0;
        outlineItem.range = new vscode.Range(sc.line, 0, sc.line, scLineLen);

        for (const ex of sc.outlineExpansions) {
          const rowId = `${filePath}:${ex.line}`;
          const rowItem = this.controller.createTestItem(rowId, ex.behaveName, uri);
          const rowLen = lines[ex.line]?.length ?? 0;
          rowItem.range = new vscode.Range(ex.line, 0, ex.line, rowLen);
          outlineItem.children.add(rowItem);
        }
        featureItem.children.add(outlineItem);
      } else {
        const scId = `${filePath}:${sc.line}`;
        const scItem = this.controller.createTestItem(scId, sc.name, uri);
        const scLineLen = lines[sc.line]?.length ?? 0;
        scItem.range = new vscode.Range(sc.line, 0, sc.line, scLineLen);
        featureItem.children.add(scItem);
      }
    }
  }

  private async handleTestRun(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    isDebug: boolean
  ): Promise<void> {
    if (!this.hierarchyStore) {
      return;
    }

    const targetNodes: BehaveHierarchyNode[] = [];
    const testRun = this.controller.createTestRun(request);

    try {
      const itemsToRun = request.include && request.include.length > 0
        ? request.include
        : [...this.controller.items].map(([, item]) => item);

      for (const item of itemsToRun) {
        const fsPath = item.uri?.fsPath;
        if (!fsPath) {
          continue;
        }

        if (item.parent === undefined) {
          // Feature level: runs the complete feature file
          const node = await getFeatureHierarchyNodeForPath(this.hierarchyStore, fsPath);
          if (node) {
            targetNodes.push(node);
          }
        } else {
          // Scenario or outline expansion row level: runs ONLY the clicked scenario/row
          const line = item.range?.start.line ?? 0;
          const node = await getScenarioNodeAtLine(this.hierarchyStore, fsPath, line);
          if (node) {
            targetNodes.push(node);
          } else {
            const outlineNodes = await getScenarioOutlineExpansionNodes(
              this.hierarchyStore,
              fsPath,
              line
            );
            if (outlineNodes.length > 0) {
              targetNodes.push(...outlineNodes);
            }
          }
        }
      }

      if (targetNodes.length === 0) {
        testRun.end();
        return;
      }

      // Mark all targeted items as running/enqueued
      const markStarted = (item: vscode.TestItem) => {
        testRun.started(item);
        item.children.forEach(markStarted);
      };
      itemsToRun.forEach(markStarted);

      if (isDebug) {
        await runBehaveHierarchyDebugSelection(targetNodes, token);
        itemsToRun.forEach((item) => testRun.passed(item));
      } else {
        await runBehaveHierarchySelection(targetNodes, token);
        itemsToRun.forEach((item) => testRun.passed(item));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      LOG.error("Test execution error:", msg);
    } finally {
      testRun.end();
    }
  }
}

export const behaveTestController = new BehaveTestControllerManager();
