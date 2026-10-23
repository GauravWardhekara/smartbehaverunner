import * as path from "path";
import * as vscode from "vscode";
import { BG_PREFIX, type BehaveHierarchyNode } from "./behaveHierarchyModel";
import { behaveResultsManager, type CompletedStepRecord } from "./behaveResultsManager";
import {
  countScenariosWithStrippedOutlineName,
  findBgItem,
  findScenarioItem,
  findStepUnderParent
} from "./behaveLiveStreamLookup";
import {
  normalizeScenarioName,
  parseBehaveLocation,
  pathsEqualFs,
  stripOutlineSuffix
} from "./behaveLiveStreamPaths";
import { normalizeToCrlfChunk } from "../utils/normalizeCrlf";
import type { LivePanelToWebviewMessage } from "../ui/livePanelProtocol";
import type { LiveStreamEvent, LiveStreamJob } from "./behaveLiveStreamTypes";
import type { BehaveTestRunReporter } from "./behaveTestRunReporter";

/** Behave step status name when no Python step matches (not JavaScript `undefined`). */
function statusLabelForLog(rawLower: string): string {
  if (rawLower === "undefined") {
    return "no step definition";
  }
  return rawLower;
}

function locationForBehaveStep(
  locationStr: string | undefined,
  featureUri: vscode.Uri,
  jobFsPath: string,
  workspaceRoot: string
): vscode.Location | undefined {
  const loc = parseBehaveLocation(locationStr);
  if (!loc || !pathsEqualFs(loc.filePath, jobFsPath, workspaceRoot)) {
    return undefined;
  }
  return new vscode.Location(
    featureUri,
    new vscode.Position(loc.line1Based - 1, 0)
  );
}

/**
 * Stable Live panel scenario id: hierarchy node when matched, else fingerprint of Behave's
 * expanded `scenario` string (optionally + line when multiple outlines share the same title).
 * Prefer name over raw `location` so dynamic Examples don't merge unrelated outlines.
 */
function resolveLivePanelScenarioBinding(
  featureItem: BehaveHierarchyNode,
  job: LiveStreamJob,
  scenarioName: string | undefined,
  locationStr: string | undefined,
  fsPath: string,
  workspaceRoot: string
): { key: string; scenarioItem?: BehaveHierarchyNode } | undefined {
  const scenarioItem = resolveScenarioItem(
    featureItem,
    job,
    scenarioName,
    locationStr,
    fsPath,
    workspaceRoot
  );
  if (scenarioItem) {
    return { key: scenarioItem.id, scenarioItem };
  }
  const sn = scenarioName?.trim();
  if (sn) {
    const strippedNorm = normalizeScenarioName(stripOutlineSuffix(sn));
    const sameTitleSiblings = countScenariosWithStrippedOutlineName(
      featureItem,
      strippedNorm
    );
    if (sameTitleSiblings > 1) {
      const locDup = parseBehaveLocation(locationStr);
      if (
        locDup &&
        pathsEqualFs(locDup.filePath, fsPath, workspaceRoot)
      ) {
        return {
          key: `behavelive:name:${encodeURIComponent(fsPath)}:${encodeURIComponent(sn)}:${locDup.line1Based}`
        };
      }
    }
    return {
      key: `behavelive:name:${encodeURIComponent(fsPath)}:${encodeURIComponent(sn)}`
    };
  }
  const loc = parseBehaveLocation(locationStr);
  if (loc && pathsEqualFs(loc.filePath, fsPath, workspaceRoot)) {
    return {
      key: `behavelive:scen:${encodeURIComponent(fsPath)}:${loc.line1Based}`
    };
  }
  return undefined;
}

function resolveScenarioItem(
  featureItem: BehaveHierarchyNode,
  job: LiveStreamJob,
  scenarioName: string | undefined,
  locationStr: string | undefined,
  fsPath: string,
  workspaceRoot: string
): BehaveHierarchyNode | undefined {
  if (job.kind === "scenario") {
    // Single-scenario runs already fix intent via `-n` + the selected hierarchy node.
    // Behave's expanded outline titles/locations can diverge from tree labels; binding
    // every live event to the run target keeps scenario/step icons on one row.
    return job.scenarioItem;
  }
  if (!scenarioName) {
    return undefined;
  }
  return findScenarioItem(
    featureItem,
    scenarioName,
    locationStr,
    fsPath,
    workspaceRoot
  );
}

type StepStreamFields = {
  scenario?: string;
  location?: string;
  keyword?: string;
  step?: string;
};

function resolveStepDispatchBase(
  ctx: {
    featureItem: BehaveHierarchyNode;
    job: LiveStreamJob;
    fsPath: string;
    workspaceRoot: string;
    hookFlushState?: LiveRunHookFlushState;
  },
  event: StepStreamFields,
  uri: vscode.Uri
): {
  scenarioItem: BehaveHierarchyNode | undefined;
  stepItem: BehaveHierarchyNode | undefined;
  outputAnchor: BehaveHierarchyNode;
  kw: string;
  stepText: string;
  scenarioKeyForStep: string;
  stepKey: string;
  locVs: vscode.Location | undefined;
} {
  const scenarioItem = resolveScenarioItem(
    ctx.featureItem,
    ctx.job,
    event.scenario,
    event.location,
    ctx.fsPath,
    ctx.workspaceRoot
  );
  const bgItem = findBgItem(ctx.featureItem);

  const locParsed = parseBehaveLocation(event.location);
  let stepItem: BehaveHierarchyNode | undefined;
  if (locParsed && pathsEqualFs(locParsed.filePath, ctx.fsPath, ctx.workspaceRoot)) {
    const line0 = locParsed.line1Based - 1;
    if (scenarioItem) {
      stepItem = findStepUnderParent(
        scenarioItem,
        ctx.fsPath,
        line0,
        ctx.workspaceRoot
      );
    }
    if (!stepItem && bgItem) {
      stepItem = findStepUnderParent(
        bgItem,
        ctx.fsPath,
        line0,
        ctx.workspaceRoot
      );
    }
  }

  const stepParentId = stepItem?.parent?.id;
  const stepUnderBackground = !!stepParentId?.startsWith(BG_PREFIX);

  const outputAnchor =
    scenarioItem ??
    (stepUnderBackground ? bgItem : undefined) ??
    bgItem ??
    ctx.featureItem;

  const kw = event.keyword ?? "";
  const stepText = event.step ?? "";
  /** Background steps resolve under `bgItem`; Live panel rows are per scenario — key off the active scenario, not `behave:bg:`. */
  const scenarioKeyForStep = stepUnderBackground
    ? scenarioItem?.id ??
      ctx.hookFlushState?.lastScenarioKey ??
      "__orphan__"
    : stepParentId ??
      scenarioItem?.id ??
      ctx.hookFlushState?.lastScenarioKey ??
      "__orphan__";
  const stepKey =
    stepItem?.id ??
    `anon:${scenarioKeyForStep}:${ctx.fsPath}:${encodeURIComponent(
      event.scenario ?? ""
    )}:${event.location ?? ""}:${kw}:${stepText}`;
  const locVs = locationForBehaveStep(
    event.location,
    uri,
    ctx.fsPath,
    ctx.workspaceRoot
  );

  return {
    scenarioItem,
    stepItem,
    outputAnchor,
    kw,
    stepText,
    scenarioKeyForStep,
    stepKey,
    locVs
  };
}

function stepGotoPayload(
  loc: vscode.Location | undefined
): Partial<{ gotoPath: string; gotoLine: number }> {
  if (!loc) {
    return {};
  }
  return { gotoPath: loc.uri.fsPath, gotoLine: loc.range.start.line };
}

export type LiveStreamSink = (message: LivePanelToWebviewMessage) => void;

/** Updated as scenarios start; used to attach trailing hook stdout after the last scenario. */
export type LiveRunHookFlushState = {
  lastScenarioKey?: string;
};

type HookFlushCtx = {
  livePanelSink?: LiveStreamSink;
  takePendingStdoutForHooks?: () => string;
};

/** Flush stdout captured between NDJSON events (hooks, prints) into the live panel. */
export function flushPendingHookStdout(
  ctx: HookFlushCtx,
  opts?: { scenarioKey?: string }
): void {
  const raw = ctx.takePendingStdoutForHooks?.() ?? "";
  if (!raw.trim()) {
    return;
  }
  const t = raw.replace(/\r\n/g, "\n");
  const chunk = t.endsWith("\n") ? t : `${t}\n`;
  ctx.livePanelSink?.({
    type: "hook_stdout",
    text: normalizeToCrlfChunk(chunk),
    scenarioKey: opts?.scenarioKey
  });
}

let currentScenarioStartTime = Date.now();
let currentScenarioSteps: CompletedStepRecord[] = [];

export function dispatchLiveStreamEvent(
  event: LiveStreamEvent,
  ctx: {
    featureItem: BehaveHierarchyNode;
    job: LiveStreamJob;
    fsPath: string;
    workspaceRoot: string;
    appendOutput: (
      text: string,
      test?: BehaveHierarchyNode,
      location?: vscode.Location
    ) => void;
    livePanelSink?: LiveStreamSink;
    /** Plain stdout mirrored to Output; flushed for hooks via takePendingStdoutForHooks. */
    takePendingStdoutForHooks?: () => string;
    /** Returns plain stdout not yet streamed via step_log_append; clears pending for the completed step. */
    takePendingStdoutUnsentForStepFinish?: () => string;
    /** After step_started is posted, attaches buffered stdout to the active step row (incremental streaming). */
    notifyLiveStepStarted?: (keys: {
      scenarioKey: string;
      stepKey: string;
    }) => void;
    hookFlushState?: LiveRunHookFlushState;
    testRunReporter?: BehaveTestRunReporter;
    capsFile?: string;
  }
): void {
  const uri = ctx.featureItem.uri;

  if (event.event === "scenario_started") {
    currentScenarioStartTime = Date.now();
    currentScenarioSteps = [];
    ctx.testRunReporter?.onScenarioStarted(
      ctx.fsPath,
      event.scenario,
      event.location
    );
    const binding = resolveLivePanelScenarioBinding(
      ctx.featureItem,
      ctx.job,
      event.scenario,
      event.location,
      ctx.fsPath,
      ctx.workspaceRoot
    );
    flushPendingHookStdout(ctx, {
      scenarioKey: binding?.key
    });
    if (!binding) {
      return;
    }
    if (ctx.hookFlushState) {
      ctx.hookFlushState.lastScenarioKey = binding.key;
    }
    const label = event.scenario ?? "(scenario)";
    ctx.appendOutput(`━━ ${label} ━━\r\n`, binding.scenarioItem);
    const logLine = `━━ ${label} ━━\n`;
    ctx.livePanelSink?.({
      type: "scenario",
      name: label,
      key: binding.key,
      logLine
    });
    return;
  }

  if (event.event === "step_started") {
    const b = resolveStepDispatchBase(ctx, event, uri);
    ctx.livePanelSink?.({
      type: "step_started",
      scenarioKey: b.scenarioKeyForStep,
      stepKey: b.stepKey,
      scenario: event.scenario ?? "",
      keyword: b.kw,
      text: b.stepText,
      ...stepGotoPayload(b.locVs)
    });
    ctx.notifyLiveStepStarted?.({
      scenarioKey: b.scenarioKeyForStep,
      stepKey: b.stepKey
    });
    return;
  }

  if (event.event === "scenario_finished") {
    ctx.testRunReporter?.onScenarioFinished(
      ctx.fsPath,
      event.scenario,
      event.location,
      event.status
    );
    const binding = resolveLivePanelScenarioBinding(
      ctx.featureItem,
      ctx.job,
      event.scenario,
      event.location,
      ctx.fsPath,
      ctx.workspaceRoot
    );
    if (!binding) {
      return;
    }
    ctx.livePanelSink?.({
      type: "scenario_finished",
      key: binding.key,
      status: event.status
    });

    try {
      const durationMs = Math.max(0, Date.now() - currentScenarioStartTime);
      const statusNormalized = (event.status || "unknown").toLowerCase();
      const finalStatus =
        statusNormalized === "passed"
          ? "passed"
          : statusNormalized === "failed"
            ? "failed"
            : statusNormalized === "skipped"
              ? "skipped"
              : "failed";
      const firstError = currentScenarioSteps.find((s) => s.error)?.error;
      const passedStepsCount = currentScenarioSteps.filter((s) => s.status === "passed").length;
      const failedStepsCount = currentScenarioSteps.filter((s) => s.status === "failed").length;

      behaveResultsManager.recordScenario({
        featureName: ctx.featureItem.label,
        featureFilePath: ctx.fsPath,
        relativeFilePath: path.relative(ctx.workspaceRoot, ctx.fsPath).replace(/\\/g, "/"),
        scenarioName: event.scenario || binding.scenarioItem?.label || "(scenario)",
        scenarioLine: binding.scenarioItem?.range?.start.line ?? 0,
        status: finalStatus as any,
        durationMs,
        timestamp: Date.now(),
        capsFile: ctx.capsFile,
        errorMessage: firstError,
        errorStep: currentScenarioSteps.find((s) => s.error)?.text,
        totalSteps: currentScenarioSteps.length,
        passedSteps: passedStepsCount,
        failedSteps: failedStepsCount,
        steps: [...currentScenarioSteps]
      });
    } catch (recErr) {
      // ignore recording errors
    }
    return;
  }

  if (event.event === "feature_finished") {
    ctx.testRunReporter?.onFeatureFinished(
      ctx.fsPath,
      event.feature,
      event.status
    );
    flushPendingHookStdout(ctx, {
      scenarioKey: ctx.hookFlushState?.lastScenarioKey
    });
    ctx.livePanelSink?.({
      type: "feature_finished",
      status: event.status
    });
    return;
  }

  if (event.event !== "step_finished") {
    return;
  }

  const b = resolveStepDispatchBase(ctx, event, uri);
  const rawStatus = (event.status ?? "unknown").toLowerCase();
  const statusForTree = rawStatus === "undefined" ? "failed" : rawStatus;
  const statusForLog = statusLabelForLog(rawStatus);

  const stdoutBuf = ctx.takePendingStdoutUnsentForStepFinish?.() ?? "";
  const stdoutPrefix =
    stdoutBuf.trim().length > 0
      ? stdoutBuf + (stdoutBuf.endsWith("\n") ? "" : "\n")
      : "";
  ctx.appendOutput(
    `${b.kw} ${b.stepText} ... ${statusForLog}\r\n`,
    b.outputAnchor,
    b.locVs
  );

  const err = event.error?.trim();
  if (err) {
    ctx.appendOutput(normalizeToCrlfChunk(err), b.outputAnchor, b.locVs);
  }

  ctx.testRunReporter?.onStepFinished(
    ctx.fsPath,
    event.scenario,
    event.location,
    b.kw,
    b.stepText,
    statusForTree,
    err
  );

  currentScenarioSteps.push({
    keyword: b.kw,
    text: b.stepText,
    status: (statusForTree === "passed" ? "passed" : statusForTree === "failed" ? "failed" : "skipped") as any,
    error: err || undefined
  });

  const logHeadline = `${b.kw} ${b.stepText} ... ${statusForLog}\n`;
  const logHeadlineForPanel = stdoutPrefix + logHeadline;
  let logText = logHeadlineForPanel;
  if (err) {
    logText += err + (err.endsWith("\n") ? "" : "\n");
  }

  ctx.livePanelSink?.({
    type: "step",
    scenarioKey: b.scenarioKeyForStep,
    stepKey: b.stepKey,
    scenario: event.scenario ?? "",
    keyword: b.kw,
    text: b.stepText,
    status: statusForTree,
    error: err || undefined,
    logHeadline: logHeadlineForPanel,
    logText,
    ...stepGotoPayload(b.locVs)
  });
}
