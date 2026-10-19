import * as path from "path";
import * as vscode from "vscode";
import {
  resolveBehaveFeatureChildrenIfNeeded,
  SCEN_PREFIX,
  type BehaveHierarchyStore,
  type BehaveHierarchyNode
} from "./behaveHierarchyModel";
import { revealLiveRunPanel } from "../ui/liveRunWebview";
import type { BehaveJob } from "./behaveJobTypes";
import { directFeatureChildren } from "./behaveJobTypes";
import { getBehaveHierarchyStoreRef } from "./behaveRunnerContext";
import { runBehaveDebugJobs } from "./behaveRunDebug";
import { runBehaveJobs } from "./behaveRunExecution";
import type { SerializedBehaveJob } from "./behaveRunLastRun";
import { getLastBehaveRunSnapshot } from "./behaveRunLastRun";
import {
  getFeatureHierarchyNodeForPath,
  getScenarioNodeAtLine
} from "./behaveHierarchyQueries";
import { runBehaveHierarchySelection } from "./behaveRunExecution";

async function resolveSerializedJobsForRerun(
  store: BehaveHierarchyStore,
  serialized: SerializedBehaveJob[]
): Promise<BehaveJob[] | undefined> {
  const jobs: BehaveJob[] = [];
  for (const sj of serialized) {
    const feature = await getFeatureHierarchyNodeForPath(store, sj.fsPath);
    if (!feature) {
      void vscode.window.showErrorMessage(
        `Behave Runner: feature file is no longer available (${sj.fsPath}).`
      );
      return undefined;
    }
    await resolveBehaveFeatureChildrenIfNeeded(feature);
    if (sj.kind === "feature") {
      jobs.push({ kind: "feature", featureItem: feature, fsPath: sj.fsPath });
      continue;
    }
    let scenarioItem = feature.children.get(sj.scenarioItemId);
    if (!scenarioItem || !scenarioItem.id.startsWith(SCEN_PREFIX)) {
      for (const ch of directFeatureChildren(feature)) {
        if (ch.id.startsWith(SCEN_PREFIX) && ch.label === sj.scenarioName) {
          scenarioItem = ch;
          break;
        }
      }
    }
    if (!scenarioItem || !scenarioItem.id.startsWith(SCEN_PREFIX)) {
      void vscode.window.showErrorMessage(
        `Behave Runner: scenario "${sj.scenarioName}" not found in ${path.basename(sj.fsPath)}.`
      );
      return undefined;
    }
    jobs.push({
      kind: "scenario",
      featureItem: feature,
      scenarioItem,
      scenarioName: sj.scenarioName,
      fsPath: sj.fsPath
    });
  }
  return jobs;
}

export async function rerunLastBehaveRun(): Promise<void> {
  const store = getBehaveHierarchyStoreRef();
  if (!store) {
    void vscode.window.showErrorMessage(
      "Smart Behave: hierarchy store is not ready."
    );
    return;
  }

  // 1. If active editor is a .feature file, run current scenario at cursor or current feature
  const activeDoc = vscode.window.activeTextEditor?.document;
  if (activeDoc && activeDoc.fileName.endsWith(".feature")) {
    const line = vscode.window.activeTextEditor!.selection.active.line;
    const scenNode = await getScenarioNodeAtLine(store, activeDoc.fileName, line);
    if (scenNode) {
      await revealLiveRunPanel();
      const cts = new vscode.CancellationTokenSource();
      try {
        await runBehaveHierarchySelection([scenNode], cts.token);
      } finally {
        cts.dispose();
      }
      return;
    }
    const featNode = await getFeatureHierarchyNodeForPath(store, activeDoc.fileName);
    if (featNode) {
      await revealLiveRunPanel();
      const cts = new vscode.CancellationTokenSource();
      try {
        await runBehaveHierarchySelection([featNode], cts.token);
      } finally {
        cts.dispose();
      }
      return;
    }
  }

  // 2. Otherwise rerun previous run snapshot
  const snap = getLastBehaveRunSnapshot();
  if (snap && snap.jobs.length > 0) {
    const jobs = await resolveSerializedJobsForRerun(store, snap.jobs);
    if (!jobs) {
      return;
    }
    const cts = new vscode.CancellationTokenSource();
    try {
      await revealLiveRunPanel();
      if (snap.mode === "run") {
        await runBehaveJobs(jobs, cts.token, snap.capsFile);
      } else {
        await runBehaveDebugJobs(jobs, cts.token, snap.capsFile);
      }
    } finally {
      cts.dispose();
    }
    return;
  }

  // 3. Fallback: prompt user to pick a feature from workspace
  const features = store.getAllFeatures();
  if (features.length === 1) {
    await revealLiveRunPanel();
    const cts = new vscode.CancellationTokenSource();
    try {
      await runBehaveHierarchySelection([features[0]], cts.token);
    } finally {
      cts.dispose();
    }
    return;
  } else if (features.length > 1) {
    interface FeatureQuickPickItem extends vscode.QuickPickItem {
      feature: BehaveHierarchyNode;
    }
    const items: FeatureQuickPickItem[] = features.map((f: BehaveHierarchyNode) => ({
      label: f.label,
      description: path.basename(f.uri.fsPath),
      feature: f
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a feature test to run"
    });
    if (picked) {
      await revealLiveRunPanel();
      const cts = new vscode.CancellationTokenSource();
      try {
        await runBehaveHierarchySelection([picked.feature], cts.token);
      } finally {
        cts.dispose();
      }
      return;
    }
  }

  void vscode.window.showWarningMessage(
    "Smart Behave: Open a .feature file or execute a test first to use Rerun."
  );
}
