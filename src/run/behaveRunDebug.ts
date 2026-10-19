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

export async function runBehaveDebugJobs(
  jobs: BehaveJob[],
  token: vscode.CancellationToken
): Promise<void> {
  cancelActiveBehaveRun();
  rememberBehaveRun("debug", jobs);
  const runCts = takeOverActiveRunCancellation();
  const ctx = getBehaveRunnerContext();
  if (ctx) {
    nextBehaveLiveSessionId();
    ctx.runSinks.livePanel.clear();
    if (jobs.length > 0) {
      const j0 = jobs[0];
      await resolveBehaveFeatureChildrenIfNeeded(j0.featureItem);
      ctx.runSinks.livePanel.post({
        type: "feature",
        label: j0.featureItem.label
      });
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
        justMyCode
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
