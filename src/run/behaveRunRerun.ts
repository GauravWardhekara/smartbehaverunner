import * as path from "path";
import * as vscode from "vscode";
import {
  resolveBehaveFeatureChildrenIfNeeded,
  SCEN_PREFIX,
  type BehaveHierarchyStore
} from "./behaveHierarchyModel";
import { revealLiveRunPanel } from "../ui/liveRunWebview";
import type { BehaveJob } from "./behaveJobTypes";
import { directFeatureChildren } from "./behaveJobTypes";
import { getBehaveHierarchyStoreRef } from "./behaveRunnerContext";
import { runBehaveDebugJobs } from "./behaveRunDebug";
import { runBehaveJobs } from "./behaveRunExecution";
import type { SerializedBehaveJob } from "./behaveRunLastRun";
import { getLastBehaveRunSnapshot } from "./behaveRunLastRun";
import { getFeatureHierarchyNodeForPath } from "./behaveHierarchyQueries";

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
  const snap = getLastBehaveRunSnapshot();
  if (!snap || snap.jobs.length === 0) {
    void vscode.window.showWarningMessage(
      "Behave Runner: no previous run to repeat."
    );
    return;
  }
  const store = getBehaveHierarchyStoreRef();
  if (!store) {
    void vscode.window.showErrorMessage(
      "Behave Runner: hierarchy store is not ready."
    );
    return;
  }
  const jobs = await resolveSerializedJobsForRerun(store, snap.jobs);
  if (!jobs) {
    return;
  }
  const cts = new vscode.CancellationTokenSource();
  try {
    await revealLiveRunPanel();
    if (snap.mode === "run") {
      await runBehaveJobs(jobs, cts.token);
    } else {
      await runBehaveDebugJobs(jobs, cts.token);
    }
  } finally {
    cts.dispose();
  }
}
