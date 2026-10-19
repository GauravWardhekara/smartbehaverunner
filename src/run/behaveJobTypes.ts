import * as path from "path";
import * as vscode from "vscode";
import {
  BG_PREFIX,
  FEATURE_PREFIX,
  type BehaveHierarchyNode,
  SCEN_PREFIX
} from "./behaveHierarchyModel";

export type BehaveJob =
  | { kind: "feature"; featureItem: BehaveHierarchyNode; fsPath: string }
  | {
      kind: "scenario";
      featureItem: BehaveHierarchyNode;
      scenarioItem: BehaveHierarchyNode;
      scenarioName: string;
      fsPath: string;
    };

export function directFeatureChildren(
  featureItem: BehaveHierarchyNode
): BehaveHierarchyNode[] {
  return [...featureItem.children.values()].filter(
    (ch) => ch.parent === featureItem
  );
}

function normalizeFsPath(p: string): string {
  return path.normalize(p).replace(/\\/g, "/").toLowerCase();
}

export function planJobs(targets: BehaveHierarchyNode[]): BehaveJob[] {
  const whole = new Map<string, BehaveHierarchyNode>();
  const scenarios = new Map<string, BehaveJob>();

  function addScenarioIfNotWholeFeature(
    feature: BehaveHierarchyNode,
    scenarioItem: BehaveHierarchyNode,
    fp: string
  ): void {
    const key = normalizeFsPath(fp);
    if (!whole.has(key)) {
      scenarios.set(scenarioItem.id, {
        kind: "scenario",
        featureItem: feature,
        scenarioItem,
        scenarioName: scenarioItem.label,
        fsPath: fp
      });
    }
  }

  for (const item of targets) {
    if (item.id.startsWith(FEATURE_PREFIX)) {
      const fp = item.uri?.fsPath;
      if (fp) {
        whole.set(normalizeFsPath(fp), item);
      }
      continue;
    }
    if (item.id.startsWith(SCEN_PREFIX)) {
      const feature = item.parent;
      const fp = feature?.uri?.fsPath;
      if (feature && fp) {
        addScenarioIfNotWholeFeature(feature, item, fp);
      }
      continue;
    }
    if (item.id.includes("::step:")) {
      const suite = item.parent;
      const feature = suite?.parent;
      const fp = feature?.uri?.fsPath;
      if (!suite || !feature || !fp || whole.has(normalizeFsPath(fp))) {
        continue;
      }
      if (suite.id.startsWith(SCEN_PREFIX)) {
        addScenarioIfNotWholeFeature(feature, suite, fp);
      } else if (suite.id.startsWith(BG_PREFIX)) {
        whole.set(normalizeFsPath(fp), feature);
      }
      continue;
    }
    if (item.id.startsWith(BG_PREFIX)) {
      const feature = item.parent;
      const fp = feature?.uri?.fsPath;
      if (feature && fp) {
        whole.set(normalizeFsPath(fp), feature);
      }
    }
  }

  const jobs: BehaveJob[] = [];
  for (const [, featureItem] of whole) {
    jobs.push({
      kind: "feature",
      featureItem,
      fsPath: featureItem.uri.fsPath
    });
  }
  for (const job of scenarios.values()) {
    if (!whole.has(normalizeFsPath(job.fsPath))) {
      jobs.push(job);
    }
  }
  return jobs;
}

export function getWorkspaceRootForFile(filePath: string): string {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
  if (folder) {
    return folder.uri.fsPath;
  }
  if (vscode.workspace.workspaceFolders?.[0]) {
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
  }
  return path.dirname(filePath);
}
