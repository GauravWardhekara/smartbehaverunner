import * as vscode from "vscode";
import type { BehaveJob } from "./behaveJobTypes";

export type SerializedBehaveJob =
  | { kind: "feature"; fsPath: string }
  | {
      kind: "scenario";
      fsPath: string;
      scenarioName: string;
      scenarioItemId: string;
    };

export type LastBehaveRunSnapshot = {
  mode: "run" | "debug";
  jobs: SerializedBehaveJob[];
};

const LAST_RUN_WORKSPACE_KEY = "behaveRunner.lastRunSnapshot.v1";

let lastBehaveRunSnapshot: LastBehaveRunSnapshot | undefined;

let behaveExtensionContext: vscode.ExtensionContext | undefined;

export function registerBehaveRunWorkspacePersistence(
  context: vscode.ExtensionContext
): void {
  behaveExtensionContext = context;
  const raw = context.workspaceState.get<unknown>(LAST_RUN_WORKSPACE_KEY);
  const restored = parseStoredLastRunSnapshot(raw);
  if (restored) {
    lastBehaveRunSnapshot = restored;
  }
}

function parseStoredLastRunSnapshot(
  raw: unknown
): LastBehaveRunSnapshot | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  if (o.mode !== "run" && o.mode !== "debug") {
    return undefined;
  }
  if (!Array.isArray(o.jobs) || o.jobs.length === 0) {
    return undefined;
  }
  const jobs: SerializedBehaveJob[] = [];
  for (const entry of o.jobs) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const j = entry as Record<string, unknown>;
    const kind = j.kind;
    if (kind === "feature") {
      if (typeof j.fsPath !== "string" || j.fsPath.length === 0) {
        return undefined;
      }
      jobs.push({ kind: "feature", fsPath: j.fsPath });
      continue;
    }
    if (kind === "scenario") {
      if (
        typeof j.fsPath !== "string" ||
        j.fsPath.length === 0 ||
        typeof j.scenarioName !== "string" ||
        typeof j.scenarioItemId !== "string"
      ) {
        return undefined;
      }
      jobs.push({
        kind: "scenario",
        fsPath: j.fsPath,
        scenarioName: j.scenarioName,
        scenarioItemId: j.scenarioItemId
      });
      continue;
    }
    return undefined;
  }
  return { mode: o.mode, jobs };
}

function persistLastRunSnapshot(snap: LastBehaveRunSnapshot): void {
  const ctx = behaveExtensionContext;
  if (!ctx) {
    return;
  }
  void ctx.workspaceState.update(LAST_RUN_WORKSPACE_KEY, snap);
}

function serializeBehaveJobs(jobs: BehaveJob[]): SerializedBehaveJob[] {
  return jobs.map((j) =>
    j.kind === "feature"
      ? { kind: "feature", fsPath: j.fsPath }
      : {
          kind: "scenario",
          fsPath: j.fsPath,
          scenarioName: j.scenarioName,
          scenarioItemId: j.scenarioItem.id
        }
  );
}

export function rememberBehaveRun(mode: "run" | "debug", jobs: BehaveJob[]): void {
  if (jobs.length === 0) {
    return;
  }
  const snap: LastBehaveRunSnapshot = {
    mode,
    jobs: serializeBehaveJobs(jobs)
  };
  lastBehaveRunSnapshot = snap;
  persistLastRunSnapshot(snap);
}

export function getLastBehaveRunSnapshot():
  | LastBehaveRunSnapshot
  | undefined {
  return lastBehaveRunSnapshot;
}
