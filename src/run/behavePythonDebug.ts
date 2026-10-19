import * as path from "path";
import * as vscode from "vscode";
import { escapeBehaveNameSelect } from "../core";
import type { BehaveJob } from "./behaveJobTypes";
import { getLaunchJsonSmartBehaveArgs } from "./behaveLaunchConfig";
import { applyCapsFileArg } from "./behaveConfigFile";

export function getJustMyCodeForResource(resourcePath: string): boolean {
  const resourceUri = vscode.Uri.file(resourcePath);
  const cfg = vscode.workspace.getConfiguration("behave", resourceUri);
  const val = cfg.get<boolean>("debug.justMyCode");
  if (val !== undefined && val !== null) {
    return val;
  }
  return vscode.workspace
    .getConfiguration("behaveRunner", resourceUri)
    .get<boolean>("debug.justMyCode", true);
}

/** User-supplied behave CLI tokens from `behave.extraArgs`, `behaveRunner.behave.extraArgs`, or `launch.json`. */
export function getBehaveExtraArgsForResource(
  resourcePath: string,
  capsFile?: string
): string[] {
  const resourceUri = vscode.Uri.file(resourcePath);
  const cfg = vscode.workspace.getConfiguration("behave", resourceUri);
  let args = cfg.get<string[]>("extraArgs");
  if (!Array.isArray(args) || args.length === 0) {
    const raw = vscode.workspace
      .getConfiguration("behaveRunner", resourceUri)
      .get<unknown>("behave.extraArgs", []);
    if (Array.isArray(raw) && raw.length > 0) {
      args = raw.filter((item): item is string => typeof item === "string");
    } else {
      const folder = vscode.workspace.getWorkspaceFolder(resourceUri);
      const root = folder ? folder.uri.fsPath : path.dirname(resourcePath);
      args = getLaunchJsonSmartBehaveArgs(root);
    }
  }

  if (capsFile) {
    return applyCapsFileArg(args, capsFile);
  }
  return args;
}

export type PythonBehaveDebugLaunch = {
  workspaceRoot: string;
  workspaceFolder: vscode.WorkspaceFolder | undefined;
  config: vscode.DebugConfiguration;
};

/**
 * Single builder for Python debug sessions that launch Behave (module behave).
 * Keeps naming aligned across CodeLens/command and hierarchy debug runs.
 */
export function buildPythonBehaveDebugLaunch(
  job: BehaveJob,
  workspaceRoot: string,
  justMyCode: boolean,
  capsFile?: string
): PythonBehaveDebugLaunch {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(
    vscode.Uri.file(job.fsPath)
  );
  const extraArgs = getBehaveExtraArgsForResource(job.fsPath, capsFile);
  const debugArgs =
    job.kind === "feature"
      ? [...extraArgs, job.fsPath]
      : [...extraArgs, job.fsPath, "-n", escapeBehaveNameSelect(job.scenarioName)];

  const config: vscode.DebugConfiguration = {
    type: "python",
    request: "launch",
    name:
      job.kind === "feature"
        ? "Behave: Feature"
        : `Behave: Scenario ${job.scenarioName}`,
    module: "behave",
    args: debugArgs,
    cwd: workspaceRoot,
    console: "integratedTerminal",
    justMyCode,
    pythonArgs: ["-u"],
    env: { PYTHONUNBUFFERED: "1" }
  };

  return { workspaceRoot, workspaceFolder: workspaceFolder ?? undefined, config };
}

/** Command-line debug from keybindings (`behaveRunner.debugScenario`). */
export function buildPythonBehaveDebugLaunchFromCliArgs(args: {
  filePath: string;
  scenarioName: string;
  runAll: boolean;
  workspaceRoot: string;
  justMyCode: boolean;
  capsFile?: string;
}): PythonBehaveDebugLaunch {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(
    vscode.Uri.file(args.filePath)
  );
  const extraArgs = getBehaveExtraArgsForResource(args.filePath, args.capsFile);
  const debugArgs = args.runAll
    ? [...extraArgs, args.filePath]
    : [...extraArgs, args.filePath, "-n", escapeBehaveNameSelect(args.scenarioName)];

  const config: vscode.DebugConfiguration = {
    type: "python",
    request: "launch",
    name: args.runAll
      ? "Behave: Feature"
      : `Behave: Scenario ${args.scenarioName}`,
    module: "behave",
    args: debugArgs,
    cwd: args.workspaceRoot,
    console: "integratedTerminal",
    justMyCode: args.justMyCode,
    pythonArgs: ["-u"],
    env: { PYTHONUNBUFFERED: "1" }
  };

  return {
    workspaceRoot: args.workspaceRoot,
    workspaceFolder: workspaceFolder ?? undefined,
    config
  };
}
