/**
 * Messages from the extension host to the Live run webview.
 * Keep in sync with media/liveRunPanel script handlers.
 */

/** Bump when adding/removing/changing host→webview message shapes. */
export const LIVE_PANEL_PROTOCOL_VERSION = 1;

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
  | { type: "runCancelled" };

/** Messages from the Live run webview to the extension host. */
export type LivePanelFromWebviewMessage =
  | { type: "livePanelReady" }
  | { type: "stopRun" }
  | { type: "rerunLastRun" }
  | {
      type: "revealStep";
      path?: string;
      gotoPath?: string;
      line?: number | string;
      gotoLine?: number | string;
    };

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
  "runCancelled"
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
