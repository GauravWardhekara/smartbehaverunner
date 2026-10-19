import * as vscode from "vscode";
import { resolveBehaveFeatureChildrenIfNeeded } from "./behaveHierarchyModel";
import { getBehaveRunnerContext } from "./behaveRunnerContext";
import type { BehaveJob } from "./behaveJobTypes";
import { getWorkspaceRootForFile } from "./behaveJobTypes";
import {
  cancelActiveBehaveRun,
  logBehaveRunCancel,
  releaseActiveRunCancellation,
  takeOverActiveRunCancellation
} from "./behaveRunCancellation";
import { rememberBehaveRun } from "./behaveRunLastRun";
import {
  buildPythonBehaveDebugLaunch,
  getJustMyCodeForResource
} from "./behavePythonDebug";
import { nextBehaveLiveSessionId } from "./behaveRunSession";
import { promptOrResolveCapsFile } from "./behaveConfigFile";

export async function runBehaveDebugJobs(
  jobs: BehaveJob[],
  token: vscode.CancellationToken,
  capsFile?: string
): Promise<void> {
  if (jobs.length === 0) {
    return;
  }

  let actualCapsFile = capsFile;
  if (actualCapsFile === undefined) {
    const res = await promptOrResolveCapsFile(jobs[0].fsPath);
    if (res === null) {
      // User cancelled QuickPick
      return;
    }
    actualCapsFile = res;
  }

  cancelActiveBehaveRun();
  rememberBehaveRun("debug", jobs, actualCapsFile);
  const runCts = takeOverActiveRunCancellation();
  const ctx = getBehaveRunnerContext();
  if (ctx) {
    nextBehaveLiveSessionId();
    ctx.runSinks.livePanel.clear();
    if (jobs.length > 0) {
      const j0 = jobs[0];
      await resolveBehaveFeatureChildrenIfNeeded(j0.featureItem);
      const title = j0.kind === "scenario" ? `Debug Scenario: ${j0.scenarioName}` : `Debug Feature: ${j0.featureItem.label}`;
      ctx.runSinks.livePanel.post({
        type: "run_started",
        label: title,
        command: "debugpy (Python Interactive Debugger)"
      });
      ctx.runSinks.livePanel.post({
        type: "feature",
        label: j0.featureItem.label
      });
      ctx.runSinks.livePanel.post({
        type: "raw_log",
        text: `\x1b[36m▶ Starting Python Debug Session for ${title}...\x1b[0m\r\n\x1b[90mAttach debugger via debugpy. Breakpoints and step debugging active.\x1b[0m\r\n\r\n`
      });
      if (actualCapsFile) {
        ctx.runSinks.livePanel.post({
          type: "raw_log",
          text: `\x1b[36m[Smart Behave] Configuration: -D caps_file=${actualCapsFile}\x1b[0m\r\n`
        });
      }
    }
  }
  const parentReg = token.onCancellationRequested(() => {
    logBehaveRunCancel(
      "runBehaveDebugJobs: outer token cancelled → runCts.cancel()"
    );
    runCts.cancel();
  });
  try {
    for (const job of jobs) {
      if (runCts.token.isCancellationRequested) {
        break;
      }
      const workspaceRoot = getWorkspaceRootForFile(job.fsPath);
      const justMyCode = getJustMyCodeForResource(job.fsPath);
      const { workspaceFolder, config } = buildPythonBehaveDebugLaunch(
        job,
        workspaceRoot,
        justMyCode,
        actualCapsFile
      );

      const started = await vscode.debug.startDebugging(
        workspaceFolder ?? undefined,
        config
      );
      if (!started) {
        vscode.window.showErrorMessage(
          "Behave Runner: failed to start debugger."
        );
        break;
      }
      await new Promise<void>((resolvePromise) => {
        let settled = false;
        let sub: vscode.Disposable | undefined;
        let cancelReg: vscode.Disposable | undefined;
        const finish = (): void => {
          if (settled) {
            return;
          }
          settled = true;
          sub?.dispose();
          cancelReg?.dispose();
          resolvePromise();
        };
        sub = vscode.debug.onDidTerminateDebugSession(() => {
          finish();
        });
        cancelReg = runCts.token.onCancellationRequested(() => {
          logBehaveRunCancel(
            "runBehaveDebugJobs: inner token cancelled → vscode.debug.stopDebugging()"
          );
          void vscode.debug.stopDebugging();
          finish();
        });
      });
    }
  } finally {
    parentReg.dispose();
    releaseActiveRunCancellation(runCts);
  }
}
