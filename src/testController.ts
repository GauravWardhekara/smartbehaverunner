import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { parseFeatureFile, ParsedFeature } from "./core";
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
import { parseBehaveLocation } from "./run/behaveLiveStreamPaths";
import type { BehaveTestRunReporter } from "./run/behaveTestRunReporter";
import type { BehaveJob } from "./run/behaveJobTypes";
import { settings } from "./settings";

function normalizePathKey(p: string): string {
  return path.normalize(p).replace(/\\/g, "/").toLowerCase();
}

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

interface FeatureRunStats {
  featureItem?: vscode.TestItem;
  hasFailures: boolean;
  failedScenarios: Set<string>;
  passedScenarios: Set<string>;
  skippedScenarios: Set<string>;
  scenarioErrors: Map<string, vscode.TestMessage[]>;
  scenarioStartTimes: Map<string, number>;
  activeScenarios: Set<vscode.TestItem>;
  startTime: number;
}

export class ActiveTestRunSession implements BehaveTestRunReporter {
  private readonly featureStats = new Map<string, FeatureRunStats>();
  private disposed = false;

  constructor(
    private readonly controller: vscode.TestController,
    private readonly testRun: vscode.TestRun,
    private readonly manager: BehaveTestControllerManager,
    private readonly onDisposed?: () => void
  ) {}

  get isDisposed(): boolean {
    return this.disposed;
  }

  private getOrCreateFeatureStats(fsPath: string): FeatureRunStats {
    const key = normalizePathKey(fsPath);
    let stats = this.featureStats.get(key);
    if (!stats) {
      const featureItem = this.manager.findFeatureTestItem(fsPath);
      stats = {
        featureItem,
        hasFailures: false,
        failedScenarios: new Set(),
        passedScenarios: new Set(),
        skippedScenarios: new Set(),
        scenarioErrors: new Map(),
        scenarioStartTimes: new Map(),
        activeScenarios: new Set(),
        startTime: Date.now()
      };
      this.featureStats.set(key, stats);
      if (featureItem) {
        this.testRun.started(featureItem);
      }
    }
    return stats;
  }

  onScenarioStarted(fsPath: string, scenarioName?: string, locationStr?: string): void {
    if (this.disposed) return;
    const stats = this.getOrCreateFeatureStats(fsPath);
    const loc = parseBehaveLocation(locationStr);
    const line0 = loc ? loc.line1Based - 1 : undefined;
    const { scenarioItem, outlineItem } = this.manager.findScenarioTestItem(
      stats.featureItem,
      scenarioName,
      line0
    );

    if (outlineItem) {
      this.testRun.started(outlineItem);
    }
    if (scenarioItem) {
      this.testRun.started(scenarioItem);
      stats.scenarioStartTimes.set(scenarioItem.id, Date.now());
      stats.activeScenarios.add(scenarioItem);
    } else if (outlineItem) {
      stats.scenarioStartTimes.set(outlineItem.id, Date.now());
      stats.activeScenarios.add(outlineItem);
    }
  }

  onStepFinished(
    fsPath: string,
    scenarioName?: string,
    locationStr?: string,
    keyword?: string,
    stepText?: string,
    status?: string,
    error?: string
  ): void {
    if (this.disposed) return;
    const s = (status || "").toLowerCase();
    const isFail = s === "failed" || s === "error" || s === "undefined";
    if (!isFail) {
      return;
    }

    const stats = this.getOrCreateFeatureStats(fsPath);
    const loc = parseBehaveLocation(locationStr);
    const line0 = loc ? loc.line1Based - 1 : undefined;
    const { scenarioItem, outlineItem } = this.manager.findScenarioTestItem(
      stats.featureItem,
      scenarioName,
      line0
    );
    const targetItem = scenarioItem || outlineItem;
    const targetKey = targetItem ? targetItem.id : (scenarioName || `L${line0 ?? "unknown"}`);

    const errText = (error && error.trim().length > 0)
      ? error.trim()
      : `Step failed: ${keyword || ""} ${stepText || ""}`.trim();

    const msg = createTestMessageFromError(errText);
    if (loc && stats.featureItem?.uri) {
      msg.location = new vscode.Location(stats.featureItem.uri, new vscode.Position(loc.line1Based - 1, 0));
    }

    let errList = stats.scenarioErrors.get(targetKey);
    if (!errList) {
      errList = [];
      stats.scenarioErrors.set(targetKey, errList);
    }
    errList.push(msg);

    stats.hasFailures = true;
    stats.failedScenarios.add(targetKey);
  }

  onScenarioFinished(
    fsPath: string,
    scenarioName?: string,
    locationStr?: string,
    status?: string
  ): void {
    if (this.disposed) return;
    const stats = this.getOrCreateFeatureStats(fsPath);
    const loc = parseBehaveLocation(locationStr);
    const line0 = loc ? loc.line1Based - 1 : undefined;
    const { scenarioItem, outlineItem } = this.manager.findScenarioTestItem(
      stats.featureItem,
      scenarioName,
      line0
    );
    const targetItem = scenarioItem || outlineItem;
    const targetKey = targetItem ? targetItem.id : (scenarioName || `L${line0 ?? "unknown"}`);

    const startTime = targetItem ? stats.scenarioStartTimes.get(targetItem.id) : undefined;
    const duration = startTime ? Date.now() - startTime : undefined;

    const s = (status || "").toLowerCase();
    const isFail = s === "failed" || s === "error" || s === "undefined" || stats.failedScenarios.has(targetKey);
    const isSkip = s === "skipped";
    const isPass = !isFail && !isSkip && (s === "passed" || s === "pending");

    if (isFail) {
      stats.hasFailures = true;
      stats.failedScenarios.add(targetKey);
      stats.passedScenarios.delete(targetKey);

      const msgs = stats.scenarioErrors.get(targetKey) || [
        new vscode.TestMessage(`Scenario failed: ${scenarioName || ""}`)
      ];

      if (scenarioItem) {
        this.testRun.failed(scenarioItem, msgs, duration);
        stats.activeScenarios.delete(scenarioItem);
      }
      if (outlineItem) {
        this.testRun.failed(outlineItem, msgs, duration);
        stats.activeScenarios.delete(outlineItem);
      }
    } else if (isPass) {
      stats.passedScenarios.add(targetKey);
      stats.failedScenarios.delete(targetKey);

      if (scenarioItem) {
        this.testRun.passed(scenarioItem, duration);
        stats.activeScenarios.delete(scenarioItem);
      }
      if (outlineItem && outlineItem !== scenarioItem) {
        if (!stats.hasFailures) {
          this.testRun.passed(outlineItem, duration);
        }
      }
    } else if (isSkip) {
      stats.skippedScenarios.add(targetKey);
      if (scenarioItem) {
        this.testRun.skipped(scenarioItem);
        stats.activeScenarios.delete(scenarioItem);
      }
      if (outlineItem) {
        this.testRun.skipped(outlineItem);
        stats.activeScenarios.delete(outlineItem);
      }
    }
  }

  onFeatureFinished(
    fsPath: string,
    _featureName?: string,
    status?: string
  ): void {
    if (this.disposed) return;
    const stats = this.getOrCreateFeatureStats(fsPath);
    if (!stats.featureItem) {
      return;
    }

    const duration = Date.now() - stats.startTime;

    // RULE:
    // If a scenario fails then the scenario should be marked as failed.
    // If one or many scenarios fails then the whole Feature MUST fail!
    // And vice versa: if all scenarios pass and none fail, the whole Feature MUST pass!
    if (
      stats.hasFailures ||
      stats.failedScenarios.size > 0 ||
      (status && (status.toLowerCase() === "failed" || status.toLowerCase() === "error"))
    ) {
      const failCount = stats.failedScenarios.size;
      const msg = new vscode.TestMessage(
        `Feature failed: ${failCount > 0 ? failCount + " scenario(s) failed." : "execution failed."}`
      );
      this.testRun.failed(stats.featureItem, msg, duration);
    } else if (stats.passedScenarios.size > 0 && stats.failedScenarios.size === 0) {
      this.testRun.passed(stats.featureItem, duration);
    } else if (
      stats.skippedScenarios.size > 0 &&
      stats.passedScenarios.size === 0 &&
      stats.failedScenarios.size === 0
    ) {
      this.testRun.skipped(stats.featureItem);
    } else {
      const s = (status || "").toLowerCase();
      if (s === "passed") {
        this.testRun.passed(stats.featureItem, duration);
      } else if (s === "failed" || s === "error") {
        this.testRun.failed(stats.featureItem, new vscode.TestMessage("Feature execution failed"), duration);
      }
    }
  }

  onRunFinished(exitCode: number): void {
    if (this.disposed) return;

    for (const stats of this.featureStats.values()) {
      if (exitCode !== 0) {
        for (const scItem of stats.activeScenarios) {
          this.testRun.failed(
            scItem,
            new vscode.TestMessage(`Test run terminated with exit code ${exitCode}`)
          );
        }
        stats.activeScenarios.clear();

        if (stats.featureItem) {
          this.testRun.failed(
            stats.featureItem,
            new vscode.TestMessage(`Feature execution failed with exit code ${exitCode}`)
          );
        }
      } else {
        for (const scItem of stats.activeScenarios) {
          if (stats.failedScenarios.has(scItem.id)) {
            this.testRun.failed(
              scItem,
              stats.scenarioErrors.get(scItem.id) || [new vscode.TestMessage("Scenario failed")]
            );
          } else {
            this.testRun.passed(scItem);
          }
        }
        stats.activeScenarios.clear();

        if (stats.featureItem) {
          if (stats.hasFailures || stats.failedScenarios.size > 0) {
            this.testRun.failed(
              stats.featureItem,
              new vscode.TestMessage(
                `Feature failed: ${stats.failedScenarios.size} scenario(s) failed.`
              )
            );
          } else if (stats.passedScenarios.size > 0) {
            this.testRun.passed(stats.featureItem);
          }
        }
      }
    }

    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.testRun.end();
    } catch {
      // ignore
    }
    this.onDisposed?.();
  }
}

export class BehaveTestControllerManager {
  private readonly controller: vscode.TestController;
  private hierarchyStore?: BehaveHierarchyStore;
  private activeSession?: ActiveTestRunSession;

  constructor() {
    this.controller = vscode.tests.createTestController("behave", "Behave");
  }

  getController(): vscode.TestController {
    return this.controller;
  }

  getActiveReporter(): BehaveTestRunReporter | undefined {
    return this.activeSession;
  }

  setHierarchyStore(store: BehaveHierarchyStore): void {
    this.hierarchyStore = store;
  }

  createSession(testRun: vscode.TestRun): ActiveTestRunSession {
    this.activeSession?.dispose();
    const session = new ActiveTestRunSession(
      this.controller,
      testRun,
      this,
      () => {
        if (this.activeSession === session) {
          this.activeSession = undefined;
        }
      }
    );
    this.activeSession = session;
    return session;
  }

  ensureActiveReporterForJobs(jobs: BehaveJob[]): BehaveTestRunReporter {
    if (this.activeSession && !this.activeSession.isDisposed) {
      return this.activeSession;
    }
    const testItems: vscode.TestItem[] = [];
    for (const job of jobs) {
      const fi = this.findFeatureTestItem(job.fsPath);
      if (fi) {
        if (job.kind === "scenario") {
          const line0 = job.scenarioItem.range?.start.line;
          const { scenarioItem, outlineItem } = this.findScenarioTestItem(fi, job.scenarioName, line0);
          const target = scenarioItem || outlineItem;
          if (target) {
            testItems.push(target);
          } else {
            testItems.push(fi);
          }
        } else {
          testItems.push(fi);
        }
      }
    }
    const req = new vscode.TestRunRequest(testItems.length > 0 ? testItems : undefined);
    const testRun = this.controller.createTestRun(req);
    return this.createSession(testRun);
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

  findFeatureTestItem(fsPath: string): vscode.TestItem | undefined {
    const key = normalizePathKey(fsPath);
    for (const [, item] of this.controller.items) {
      if (item.uri && normalizePathKey(item.uri.fsPath) === key) {
        return item;
      }
    }
    return this.controller.items.get(fsPath);
  }

  findScenarioTestItem(
    featureItem: vscode.TestItem | undefined,
    scenarioName?: string,
    line0?: number
  ): { scenarioItem?: vscode.TestItem; outlineItem?: vscode.TestItem } {
    if (!featureItem) {
      return {};
    }

    // 1. Try matching by 0-based line number first
    if (line0 !== undefined && Number.isFinite(line0)) {
      for (const [, child] of featureItem.children) {
        // If child is a Scenario Outline with Example rows
        if (child.children.size > 0) {
          for (const [, row] of child.children) {
            if (row.range?.start.line === line0) {
              return { scenarioItem: row, outlineItem: child };
            }
          }
        }
        if (child.range?.start.line === line0) {
          return { scenarioItem: child, outlineItem: child.children.size > 0 ? child : undefined };
        }
      }
    }

    // 2. Try matching by name
    if (scenarioName && scenarioName.trim().length > 0) {
      const normTarget = scenarioName.trim().toLowerCase();
      const strippedTarget = scenarioName.replace(/\s+--\s+@.+$/, "").trim().toLowerCase();

      for (const [, child] of featureItem.children) {
        if (child.children.size > 0) {
          for (const [, row] of child.children) {
            const rowLabel = row.label.trim().toLowerCase();
            if (rowLabel === normTarget || rowLabel === strippedTarget) {
              return { scenarioItem: row, outlineItem: child };
            }
          }
        }
        const childLabel = child.label.trim().toLowerCase();
        if (childLabel === normTarget || childLabel === strippedTarget) {
          return { scenarioItem: child, outlineItem: child.children.size > 0 ? child : undefined };
        }
      }
    }

    return {};
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
    const session = this.createSession(testRun);

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
        session.dispose();
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
      } else {
        await runBehaveHierarchySelection(targetNodes, token);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      LOG.error("Test execution error:", msg);
    } finally {
      session.dispose();
    }
  }
}

export const behaveTestController = new BehaveTestControllerManager();
