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
import { promptOrResolveCapsFile } from "./behaveConfigFile";
import { behaveTestController } from "../testController";

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
  liveOpts?: { skipLivePanelReset?: boolean; capsFile?: string; extraCliArgs?: string[] }
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
  const startTime = Date.now();
  const runLabel =
    runJob.kind === "scenario"
      ? `Scenario: ${runJob.scenarioName}`
      : `Feature: ${featureItem.label}`;
  const cmdDisplay = `${interpreter.path ? interpreter.path : "python"} -m behave ${path.basename(fsPath)}`;

  function livePanelSinkWrap(message: LivePanelToWebviewMessage): void {
    if (!isCurrentBehaveLiveSession(liveSessionId)) {
      return;
    }
    sinks.livePanel.post(message);
  }

  try {
    if (!liveOpts?.skipLivePanelReset) {
      sinks.livePanel.post({
        type: "run_started",
        label: runLabel,
        command: cmdDisplay
      });
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

    const reporter = behaveTestController.getActiveReporter();

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
      hookFlushState,
      testRunReporter: reporter,
      capsFile: liveOpts?.capsFile
    };

    const proc = spawnBehave(runJob, workspaceRoot, interpreter.path, {
      liveFormatterPythonRoot: liveFormatterRoot,
      capsFile: liveOpts?.capsFile,
      extraCliArgs: liveOpts?.extraCliArgs
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
          /* Full stdout mirror (including NDJSON) for the Output channel */
          sinks.output.append(line);
          if (!isCurrentBehaveLiveSession(liveSessionId)) {
            return;
          }
          const ev = parseLiveStreamLine(line);
          if (ev) {
            dispatchLiveStreamEvent(ev, liveDispatchCtx);
            let evLog = "";
            if (ev.event === "scenario_started") {
              evLog = `\r\n\x1b[36m━━ Scenario: ${ev.scenario}\x1b[0m\r\n`;
            } else if (ev.event === "step_started") {
              evLog = `  \x1b[34m▶ ${ev.keyword || ""} ${ev.step || ""}\x1b[0m\r\n`;
            } else if (ev.event === "step_finished") {
              const statusColor = ev.status === "passed" ? "\x1b[32m" : ev.status === "skipped" ? "\x1b[33m" : "\x1b[31m";
              const mark = ev.status === "passed" ? "✔" : ev.status === "skipped" ? "↷" : "✘";
              evLog = `  ${statusColor}${mark} ${ev.keyword || ""} ${ev.step || ""} (${ev.status})\x1b[0m\r\n`;
              if (ev.error) {
                evLog += `\x1b[31m${ev.error}\x1b[0m\r\n`;
              }
            } else if (ev.event === "scenario_finished") {
              const statusColor = ev.status === "passed" ? "\x1b[32m" : "\x1b[31m";
              evLog = `${statusColor}── Finished: ${ev.scenario} (${ev.status})\x1b[0m\r\n`;
            }
            if (evLog) {
              livePanelSinkWrap({
                type: "raw_log",
                text: evLog
              });
            }
          } else {
            appendPlainStdoutLine(line);
            livePanelSinkWrap({
              type: "raw_log",
              text: line + "\r\n"
            });
          }
        }
      };

      proc.stdout.on("data", onStdoutChunk);
      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        sinks.output.append(text);
        livePanelSinkWrap({
          type: "raw_log",
          text: `\x1b[31m${text}\x1b[0m`
        });
      });
      proc.on("error", (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        livePanelSinkWrap({
          type: "raw_log",
          text: `\r\n\x1b[31m[Process Error] Failed to execute Behave: ${msg}\x1b[0m\r\n`
        });
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
              livePanelSinkWrap({
                type: "raw_log",
                text: tail + "\r\n"
              });
            }
          }
        }
        if (isCurrentBehaveLiveSession(liveSessionId)) {
          reporter?.onRunFinished(exitCode);
          flushPendingHookStdout(liveDispatchCtx, {
            scenarioKey: hookFlushState.lastScenarioKey
          });
          const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
          const statusColor = exitCode === 0 ? "\x1b[32m" : "\x1b[31m";
          const statusText = exitCode === 0 ? "PASSED" : "FAILED";
          livePanelSinkWrap({
            type: "raw_log",
            text: `\r\n${statusColor}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n${statusColor}[Smart Behave] Run ${statusText} with exit code ${exitCode} in ${durationSec}s\x1b[0m\r\n`
          });
          livePanelSinkWrap({
            type: "run_finished",
            exitCode,
            duration: Number(durationSec)
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
  token: vscode.CancellationToken,
  capsFile?: string,
  extraCliArgs?: string[]
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
  const ctx = getBehaveRunnerContext();
  if (!ctx) {
    void vscode.window.showErrorMessage(
      "Behave Runner: extension context is not ready."
    );
    return;
  }
  const { runSinks: sinks, extensionPath } = ctx;

  rememberBehaveRun("run", jobs, actualCapsFile);
  const runCts = takeOverActiveRunCancellation();
  const parentReg = token.onCancellationRequested(() => runCts.cancel());
  const activeReporter = behaveTestController.ensureActiveReporterForJobs(jobs);
  const liveSessionId = nextBehaveLiveSessionId();
  sinks.livePanel.clear();
  if (actualCapsFile) {
    sinks.livePanel.post({
      type: "raw_log",
      text: `\x1b[36m[Smart Behave] Configuration: -D caps_file=${actualCapsFile}\x1b[0m\r\n`
    });
    sinks.output.append(`[Smart Behave] Configuration: -D caps_file=${actualCapsFile}\r\n`);
  }
  if (extraCliArgs && extraCliArgs.length > 0) {
    const extraStr = extraCliArgs.join(" ");
    sinks.livePanel.post({
      type: "raw_log",
      text: `\x1b[36m[Smart Behave] Extra CLI Arguments: ${extraStr}\x1b[0m\r\n`
    });
    sinks.output.append(`[Smart Behave] Extra CLI Arguments: ${extraStr}\r\n`);
  }
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
          skipLivePanelReset: batchSameFeatureScenarios && i > 0,
          capsFile: actualCapsFile,
          extraCliArgs
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
    activeReporter.dispose();
  }
}

export async function runBehaveHierarchySelection(
  items: BehaveHierarchyNode[],
  token: vscode.CancellationToken,
  capsFile?: string,
  extraCliArgs?: string[]
): Promise<void> {
  await revealLiveRunPanel();
  await runBehaveJobs(planJobs(items), token, capsFile, extraCliArgs);
}

export async function runBehaveHierarchyDebugSelection(
  items: BehaveHierarchyNode[],
  token: vscode.CancellationToken,
  capsFile?: string
): Promise<void> {
  await revealLiveRunPanel();
  await runBehaveDebugJobs(planJobs(items), token, capsFile);
}
