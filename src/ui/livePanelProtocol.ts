/**
 * Messages from the extension host to the Cucumber-Behave webview.
 * Keep in sync with media/liveRunPanel script handlers.
 */

/** Bump when adding/removing/changing host→webview message shapes. */
export const LIVE_PANEL_PROTOCOL_VERSION = 2;

export type LivePanelToWebviewMessage =
  | { type: "protocol"; version: number }
  | { type: "clear" }
  | { type: "replayCapture"; messages: unknown[] }
  | { type: "feature"; label: string }
  | {
      type: "scenario";
      name: string;
      key: string;
      logLine: string;
    }
  | {
      type: "step_started";
      scenarioKey: string;
      stepKey: string;
      scenario: string;
      keyword: string;
      text: string;
      gotoPath?: string;
      gotoLine?: number;
    }
  | { type: "scenario_finished"; key: string; status?: string }
  | { type: "feature_finished"; status?: string }
  /** Stdout from hooks / env (between NDJSON events); mirrored into feature + optional scenario logs. */
  | { type: "hook_stdout"; text: string; scenarioKey?: string }
  | {
      type: "step";
      scenarioKey: string;
      stepKey: string;
      scenario: string;
      keyword: string;
      text: string;
      status: string;
      error?: string;
      logHeadline: string;
      logText: string;
      gotoPath?: string;
      gotoLine?: number;
    }
  | { type: "step_log_append"; stepKey: string; scenarioKey: string; text: string }
  | { type: "runCancelled" }
  | { type: "raw_log"; text: string }
  | { type: "run_started"; label: string; command?: string }
  | { type: "run_finished"; exitCode: number; duration?: number }
  | { type: "discoveryData"; payload: unknown }
  | { type: "resultsData"; records: unknown[]; summary: unknown }
  | { type: "switchToTab"; tab: "discovery" | "execution" | "results" }
  | { type: "runStatus"; isRunning: boolean }
  | {
      type: "allureGenerated";
      success: boolean;
      message: string;
      reportPath?: string;
      usedCli: boolean;
    };

/** Messages from the Cucumber-Behave webview to the extension host. */
export type LivePanelFromWebviewMessage =
  | { type: "livePanelReady" }
  | { type: "stopRun" }
  | { type: "stopTest" }
  | { type: "rerunLastRun" }
  | { type: "getDiscoveryData" }
  | {
      type: "runTest";
      filePath: string;
      scenarioName?: string;
      scenarioLine?: number;
      capsFile?: string;
    }
  | {
      type: "openFile";
      filePath: string;
      line?: number;
    }
  | {
      type: "revealStep";
      path?: string;
      gotoPath?: string;
      line?: number | string;
      gotoLine?: number | string;
    }
  | { type: "getResultsData" }
  | { type: "clearResults" }
  | { type: "generateAllure" }
  | { type: "viewAllure" }
  | { type: "openMainScreen" }
  | { type: "setDefaultCaps"; capsFile: string };

export function isLivePanelFromWebviewMessage(
  msg: unknown
): msg is LivePanelFromWebviewMessage {
  return typeof msg === "object" && msg !== null && "type" in msg;
}

const HOST_TO_WEBVIEW_TYPES = new Set([
  "protocol",
  "clear",
  "replayCapture",
  "feature",
  "scenario",
  "step_started",
  "scenario_finished",
  "feature_finished",
  "hook_stdout",
  "step",
  "step_log_append",
  "runCancelled",
  "raw_log",
  "run_started",
  "run_finished",
  "discoveryData",
  "resultsData",
  "switchToTab",
  "runStatus",
  "allureGenerated"
]);

/** Best-effort guard before posting to the webview (extension host side). */
export function isLivePanelToWebviewMessage(
  msg: unknown
): msg is LivePanelToWebviewMessage {
  if (!msg || typeof msg !== "object" || !("type" in msg)) {
    return false;
  }
  const t = (msg as { type?: unknown }).type;
  return typeof t === "string" && HOST_TO_WEBVIEW_TYPES.has(t);
}
