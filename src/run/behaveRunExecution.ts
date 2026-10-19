import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { BehaveHierarchyNode } from "./behaveHierarchyModel";
import { resolveBehaveFeatureChildrenIfNeeded } from "./behaveHierarchyModel";
import {
  dispatchLiveStreamEvent,
  flushPendingHookStdout
} from "./behaveLiveStreamDispatch";
import {
  NdjsonStdoutBuffer,
  parseLiveStreamLine
} from "./behaveLiveStreamParse";
import type { LiveStreamJob } from "./behaveLiveStreamTypes";
import { getBehaveRunnerContext } from "./behaveRunnerContext";
import { revealLiveRunPanel } from "../ui/liveRunWebview";
import type { LivePanelToWebviewMessage } from "../ui/livePanelProtocol";
import { getPythonInterpreterPath } from "../utils/python";
import type { BehaveJob } from "./behaveJobTypes";
import { getWorkspaceRootForFile, planJobs } from "./behaveJobTypes";
import {
  cancelActiveBehaveRun,
  forceKillTrackedBehaveSpawn,
  logBehaveRunCancel,
  registerTrackedBehaveSpawn,
  releaseActiveRunCancellation,
  takeOverActiveRunCancellation,
  unregisterTrackedBehaveSpawn
} from "./behaveRunCancellation";
import {
  isCurrentBehaveLiveSession,
  nextBehaveLiveSessionId
} from "./behaveRunSession";
import type { BehaveRunSinks } from "./behaveRunPorts";
import { runBehaveDebugJobs } from "./behaveRunDebug";
import { rememberBehaveRun } from "./behaveRunLastRun";
import { normalizeToCrlfChunk } from "../utils/normalizeCrlf";
import { liveFormatterBundlePath, spawnBehave } from "./behaveRunSpawn";

function appendOutputForNode(
  sinks: BehaveRunSinks,
  text: string,
  _test?: BehaveHierarchyNode,
  _location?: vscode.Location
): void {
  sinks.output.append(text);
}

async function runBehaveJob(
  job: BehaveJob,
  token: vscode.CancellationToken,
  sinks: BehaveRunSinks,
  extensionPath: string,
  liveSessionId: number,
  liveOpts?: { skipLivePanelReset?: boolean }
): Promise<void> {
  const featureItem = job.featureItem;
  const fsPath = job.fsPath;
  await resolveBehaveFeatureChildrenIfNeeded(featureItem);

  const appendOut = (
    text: string,
    test?: BehaveHierarchyNode,
    loc?: vscode.Location
  ): void => appendOutputForNode(sinks, text, test, loc);

  let runJob: BehaveJob = job;
  if (job.kind === "scenario") {
    const freshScenario = featureItem.children.get(job.scenarioItem.id);
    if (!freshScenario) {
      sinks.output.append(
        `[Behave Runner] Scenario "${job.scenarioName}" not found under ${path.basename(fsPath)} after refresh.\r\n`
      );
      return;
    }
    runJob = {
      kind: "scenario",
      featureItem,
      scenarioItem: freshScenario,
      scenarioName: job.scenarioName,
      fsPath: job.fsPath
    };
  }

  const workspaceRoot = getWorkspaceRootForFile(fsPath);
  const interpreter = getPythonInterpreterPath(fsPath, workspaceRoot);

  const liveFormatterRoot = liveFormatterBundlePath(extensionPath);
  const liveBundlePresent = fs.existsSync(
    path.join(liveFormatterRoot, "behave_runner_live", "__init__.py")
  );

  if (!liveBundlePresent || extensionPath.length === 0) {
    const msg =
      "Behave Runner needs the bundled live stream formatter under media/python/behave_runner_live (reinstall or rebuild the extension).";
    sinks.output.append(`[Behave Runner] ${msg}\r\n`);
    void vscode.window.showErrorMessage(msg);
    return;
  }

  let exitCode = 0;

  function livePanelSinkWrap(message: LivePanelToWebviewMessage): void {
    if (!isCurrentBehaveLiveSession(liveSessionId)) {
      return;
    }
    sinks.livePanel.post(message);
  }

  try {
    if (!liveOpts?.skipLivePanelReset) {
      sinks.livePanel.post({
        type: "feature",
        label: featureItem.label
      });
    }

    const liveJob: LiveStreamJob =
      runJob.kind === "feature"
        ? { kind: "feature" }
        : {
            kind: "scenario",
            scenarioName: runJob.scenarioName,
            scenarioItem: runJob.scenarioItem
          };

    const ndjsonBuf = new NdjsonStdoutBuffer();
    let pendingPlainStdout = "";
    /** Bytes of pendingPlainStdout already posted as step_log_append for the active step. */
    let plainBytesSentToPanelForStep = 0;
    /** Set after NDJSON step_started until step_finished consumes pending plain. */
    let activeLiveStepKeys:
      | { scenarioKey: string; stepKey: string }
      | undefined;
    const hookFlushState: { lastScenarioKey?: string } = {};

    function appendPlainStdoutLine(rawLineComplete: string): void {
      if (activeLiveStepKeys) {
        pendingPlainStdout += rawLineComplete + "\n";
        const lf = rawLineComplete.replace(/\r\n/g, "\n") + "\n";
        livePanelSinkWrap({
          type: "step_log_append",
          scenarioKey: activeLiveStepKeys.scenarioKey,
          stepKey: activeLiveStepKeys.stepKey,
          text: normalizeToCrlfChunk(lf)
        });
        plainBytesSentToPanelForStep = pendingPlainStdout.length;
        return;
      }
      /* Before the first scenario_started NDJSON, stream plain lines immediately (Behave / env startup). */
      if (hookFlushState.lastScenarioKey === undefined) {
        const lf = rawLineComplete.replace(/\r\n/g, "\n") + "\n";
        livePanelSinkWrap({
          type: "hook_stdout",
          text: normalizeToCrlfChunk(lf)
        });
        return;
      }
      pendingPlainStdout += rawLineComplete + "\n";
    }

    function takePendingStdoutForHooks(): string {
      const s = pendingPlainStdout;
      pendingPlainStdout = "";
      plainBytesSentToPanelForStep = 0;
      activeLiveStepKeys = undefined;
      return s;
    }

    function takePendingStdoutUnsentForStepFinish(): string {
      const full = pendingPlainStdout;
      const unsent = full.slice(plainBytesSentToPanelForStep);
      pendingPlainStdout = "";
      plainBytesSentToPanelForStep = 0;
      activeLiveStepKeys = undefined;
      return unsent;
    }

    const liveDispatchCtx = {
      featureItem,
      job: liveJob,
      fsPath,
      workspaceRoot,
      appendOutput: appendOut,
      livePanelSink: livePanelSinkWrap,
      takePendingStdoutForHooks,
      takePendingStdoutUnsentForStepFinish,
      notifyLiveStepStarted: (keys: {
        scenarioKey: string;
        stepKey: string;
      }) => {
        activeLiveStepKeys = keys;
        if (pendingPlainStdout.length === 0) {
          plainBytesSentToPanelForStep = 0;
          return;
        }
        const t = pendingPlainStdout.replace(/\r\n/g, "\n");
        const chunk = t.endsWith("\n") ? t : `${t}\n`;
        livePanelSinkWrap({
          type: "step_log_append",
          scenarioKey: keys.scenarioKey,
          stepKey: keys.stepKey,
          text: normalizeToCrlfChunk(chunk)
        });
        plainBytesSentToPanelForStep = pendingPlainStdout.length;
      },
      hookFlushState
    };

    const proc = spawnBehave(runJob, workspaceRoot, interpreter.path, {
      liveFormatterPythonRoot: liveFormatterRoot
    });
    registerTrackedBehaveSpawn(proc);
    const untrackBehaveSpawn = (): void => {
      unregisterTrackedBehaveSpawn(proc);
    };
    proc.once("close", untrackBehaveSpawn);
    proc.once("error", untrackBehaveSpawn);

    await new Promise<void>((resolvePromise, rejectPromise) => {
      token.onCancellationRequested(() => {
        logBehaveRunCancel(
          `runBehaveJob: token.onCancellationRequested liveSessionId=${liveSessionId}`
        );
        forceKillTrackedBehaveSpawn("runBehaveJob token");
      });

      const onStdoutChunk = (chunk: Buffer): void => {
        if (!isCurrentBehaveLiveSession(liveSessionId)) {
          return;
        }
        const text = chunk.toString();
        for (const line of ndjsonBuf.consumeChunk(text)) {
          /* Full stdout mirror (including NDJSON) for the Output channel — debuggable trace; the Live panel stays human-only via structured messages. */
          sinks.output.append(line);
          if (!isCurrentBehaveLiveSession(liveSessionId)) {
            return;
          }
          const ev = parseLiveStreamLine(line);
          if (ev) {
            dispatchLiveStreamEvent(ev, liveDispatchCtx);
          } else {
            appendPlainStdoutLine(line);
          }
        }
      };

      proc.stdout.on("data", onStdoutChunk);
      proc.stderr.on("data", (chunk: Buffer) => {
        /* Shell wrapper noise only: Behave stderr is merged into stdout via 2>&1. */
        sinks.output.append(chunk.toString());
      });
      proc.on("error", (err) => {
        rejectPromise(err);
      });
      proc.on("close", (code) => {
        exitCode = code ?? 0;
        const tail = ndjsonBuf.flushLine();
        if (tail) {
          sinks.output.append(tail);
          if (isCurrentBehaveLiveSession(liveSessionId)) {
            const ev = parseLiveStreamLine(tail);
            if (ev) {
              dispatchLiveStreamEvent(ev, liveDispatchCtx);
            } else {
              appendPlainStdoutLine(tail);
            }
          }
        }
        if (isCurrentBehaveLiveSession(liveSessionId)) {
          flushPendingHookStdout(liveDispatchCtx, {
            scenarioKey: hookFlushState.lastScenarioKey
          });
        }
        resolvePromise();
      });
    });

    if (exitCode !== 0) {
      sinks.output.append(
        `[Behave Runner] Behave exited with code ${exitCode}.\r\n`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sinks.output.append(`Behave Runner error: ${msg}\r\n`);
    void vscode.window.showErrorMessage(`Behave Runner: ${msg}`);
  } finally {
    if (
      token.isCancellationRequested &&
      isCurrentBehaveLiveSession(liveSessionId)
    ) {
      sinks.livePanel.post({ type: "runCancelled" });
    }
  }
}

export async function runBehaveJobs(
  jobs: BehaveJob[],
  token: vscode.CancellationToken
): Promise<void> {
  cancelActiveBehaveRun();
  const ctx = getBehaveRunnerContext();
  if (!ctx) {
    void vscode.window.showErrorMessage(
      "Behave Runner: extension context is not ready."
    );
    return;
  }
  const { runSinks: sinks, extensionPath } = ctx;

  rememberBehaveRun("run", jobs);
  const runCts = takeOverActiveRunCancellation();
  const parentReg = token.onCancellationRequested(() => runCts.cancel());
  const liveSessionId = nextBehaveLiveSessionId();
  sinks.livePanel.clear();
  try {
    const batchSameFeatureScenarios =
      jobs.length > 1 &&
      jobs.every((j) => j.kind === "scenario") &&
      jobs.every((j) => j.fsPath === jobs[0].fsPath);

    for (let i = 0; i < jobs.length; i++) {
      if (runCts.token.isCancellationRequested) {
        break;
      }
      await runBehaveJob(
        jobs[i],
        runCts.token,
        sinks,
        extensionPath,
        liveSessionId,
        {
          skipLivePanelReset: batchSameFeatureScenarios && i > 0
        }
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sinks.output.append(`Behave Runner error: ${msg}\r\n`);
    void vscode.window.showErrorMessage(`Behave Runner: ${msg}`);
  } finally {
    parentReg.dispose();
    releaseActiveRunCancellation(runCts);
    sinks.livePanel.persistCapture();
  }
}

export async function runBehaveHierarchySelection(
  items: BehaveHierarchyNode[],
  token: vscode.CancellationToken
): Promise<void> {
  await revealLiveRunPanel();
  await runBehaveJobs(planJobs(items), token);
}

export async function runBehaveHierarchyDebugSelection(
  items: BehaveHierarchyNode[],
  token: vscode.CancellationToken
): Promise<void> {
  await revealLiveRunPanel();
  await runBehaveDebugJobs(planJobs(items), token);
}
