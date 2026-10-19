import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LOG } from "../log";
import {
  setLiveRunPanelGateway,
  type LiveRunPanelGateway
} from "../run/behaveRunnerContext";
import { logBehaveRunCancel } from "../run/behaveRunCancellation";
import {
  isLivePanelFromWebviewMessage,
  LIVE_PANEL_PROTOCOL_VERSION,
  type LivePanelToWebviewMessage
} from "./livePanelProtocol";

export const PRIMARY_LIVE_RUN_VIEW_TYPE = "smartBehave.liveRun";

const LIVE_PANEL_CAPTURE_KEY = "behaveRunner.livePanelCapture.v1";
/** Rough budget for `workspaceState` (limit is ~1MB per key). */
const MAX_CAPTURE_JSON_BYTES = 750_000;

let workspaceStateForLivePanel: vscode.Memento | undefined;

/** Messages posted to the Live panel during the current / last run (for workspace restore). */
let livePanelCapture: unknown[] = [];

/** Opens the bottom panel and focuses the Live run view (e.g. when starting Run/Debug). */
export async function revealLiveRunPanel(): Promise<void> {
  try {
    await vscode.commands.executeCommand("smartBehave.liveRun.focus");
  } catch {
    /* view not ready */
  }
}

function cloneForCapture(message: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(message)) as unknown;
  } catch {
    return message;
  }
}

function trimMessagesForStorage(messages: unknown[]): unknown[] {
  return messages.map((msg) => {
    if (!msg || typeof msg !== "object") {
      return msg;
    }
    const o = msg as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...o };
    if (typeof copy.logText === "string" && copy.logText.length > 8000) {
      copy.logText =
        copy.logText.slice(0, 8000) +
        "\n… [Behave Runner: truncated for storage]";
    }
    if (typeof copy.error === "string" && copy.error.length > 16000) {
      copy.error =
        copy.error.slice(0, 16000) + "\n… [Behave Runner: truncated]";
    }
    if (typeof copy.text === "string" && copy.text.length > 12000) {
      copy.text =
        copy.text.slice(0, 12000) + "\n… [Behave Runner: truncated]";
    }
    return copy;
  });
}

function shrinkCaptureIfNeeded(messages: unknown[]): unknown[] {
  let data = trimMessagesForStorage(messages);
  let json = JSON.stringify(data);
  if (json.length <= MAX_CAPTURE_JSON_BYTES) {
    return data;
  }
  data = messages.map((msg) => {
    if (!msg || typeof msg !== "object") {
      return msg;
    }
    const o = msg as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...o };
    if (typeof copy.logText === "string") {
      copy.logText = `${copy.logText.slice(0, 400)}\n… [truncated]`;
    }
    if (typeof copy.error === "string") {
      copy.error = `${copy.error.slice(0, 400)}\n… [truncated]`;
    }
    if (typeof copy.text === "string") {
      copy.text = `${copy.text.slice(0, 400)}\n… [truncated]`;
    }
    return copy;
  });
  json = JSON.stringify(data);
  while (json.length > MAX_CAPTURE_JSON_BYTES) {
    const prevLen = data.length;
    data = data.filter((m, i) => {
      if (i === 0) {
        return true;
      }
      return (
        typeof m !== "object" ||
        m === null ||
        (m as { type?: string }).type !== "step_log_append"
      );
    });
    if (data.length === prevLen) {
      break;
    }
    json = JSON.stringify(data);
  }
  return data;
}

function persistLivePanelCaptureNowImpl(): void {
  const memento = workspaceStateForLivePanel;
  if (!memento || livePanelCapture.length <= 1) {
    return;
  }
  try {
    const data = shrinkCaptureIfNeeded(livePanelCapture);
    const json = JSON.stringify(data);
    if (json.length > MAX_CAPTURE_JSON_BYTES) {
      return;
    }
    void memento.update(LIVE_PANEL_CAPTURE_KEY, data);
  } catch {
    /* ignore */
  }
}

function createLivePanelGateway(
  postToWebview: (message: LivePanelToWebviewMessage) => void
): LiveRunPanelGateway {
  return {
    post(message: LivePanelToWebviewMessage): void {
      livePanelCapture.push(cloneForCapture(message));
      postToWebview(message);
    },
    clear(): void {
      livePanelCapture = [{ type: "clear" }];
      postToWebview({ type: "clear" });
    },
    persistCapture(): void {
      persistLivePanelCaptureNowImpl();
    }
  };
}

export function registerLiveRunWebview(
  context: vscode.ExtensionContext
): void {
  workspaceStateForLivePanel = context.workspaceState;
  const provider = new LiveRunWebviewProvider(context.extensionUri);

  // Register smartBehave.liveRun view provider
  try {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(PRIMARY_LIVE_RUN_VIEW_TYPE, provider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );
  } catch (err) {
    LOG.warn("Failed to register primary liveRun view provider:", err);
  }
}

function loadLiveRunHtml(extensionUri: vscode.Uri): string {
  const filePath = path.join(extensionUri.fsPath, "media", "liveRunPanel.html");
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:12px">Behave Runner: could not read <code>media/liveRunPanel.html</code>.</body></html>`;
  }
}

function buildLiveRunPanelHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  let html = loadLiveRunHtml(extensionUri);
  const codiconCss = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "codicons", "codicon.css")
  );
  const bundledJs = vscode.Uri.joinPath(
    extensionUri,
    "media",
    "liveRunPanel.bundle.js"
  );
  const useBundle = fs.existsSync(bundledJs.fsPath);
  const scriptSrc = useBundle ? webview.asWebviewUri(bundledJs).toString() : "";
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    useBundle
      ? `script-src ${webview.cspSource}`
      : "script-src 'unsafe-inline'"
  ].join("; ");
  html = html.replace("BEHAVE_RUN_CSP_PLACEHOLDER", csp);
  html = html.replace(
    "BEHAVE_RUN_CODICON_LINK_PLACEHOLDER",
    `<link rel="stylesheet" href="${codiconCss}" />`
  );
  html = html.replace(
    "BEHAVE_RUN_SCRIPT_PLACEHOLDER",
    useBundle
      ? `<script src="${scriptSrc}"></script>`
      : "<!-- Behave Runner: run npm run build:webview to produce media/liveRunPanel.bundle.js -->"
  );
  return html;
}

class LiveRunWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  /** Must be single-shot per webview; stacking listeners duplicates replay + console output. */
  private webviewMessageDisposable?: vscode.Disposable;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewMessageDisposable?.dispose();
    this.webviewMessageDisposable = undefined;

    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = buildLiveRunPanelHtml(
      webviewView.webview,
      this.extensionUri
    );

    const gateway = createLivePanelGateway((msg) => {
      void webviewView.webview.postMessage(msg);
    });
    setLiveRunPanelGateway(gateway);

    this.webviewMessageDisposable = webviewView.webview.onDidReceiveMessage(
      (msg: unknown) => {
        void handleLiveRunWebviewMessage(webviewView.webview, msg);
      }
    );

    webviewView.onDidDispose(() => {
      this.webviewMessageDisposable?.dispose();
      this.webviewMessageDisposable = undefined;
      if (this.view === webviewView) {
        setLiveRunPanelGateway(undefined);
        this.view = undefined;
      }
    });
  }
}

function postStoredLivePanelReplay(webview: vscode.Webview): void {
  const memento = workspaceStateForLivePanel;
  if (!memento) {
    return;
  }
  const saved = memento.get<unknown[]>(LIVE_PANEL_CAPTURE_KEY);
  if (!Array.isArray(saved) || saved.length === 0) {
    return;
  }
  const replay: LivePanelToWebviewMessage = {
    type: "replayCapture",
    messages: saved
  };
  void webview.postMessage(replay);
}

async function handleLiveRunWebviewMessage(
  webview: vscode.Webview,
  msg: unknown
): Promise<void> {
  if (!isLivePanelFromWebviewMessage(msg)) {
    return;
  }
  if (msg.type === "livePanelReady") {
    void webview.postMessage({
      type: "protocol",
      version: LIVE_PANEL_PROTOCOL_VERSION
    });
    postStoredLivePanelReplay(webview);
    return;
  }
  if (msg.type === "stopRun") {
    logBehaveRunCancel(
      "Live panel Stop: posting behaveRunner.cancelRun (webview → extension host)"
    );
    await vscode.commands.executeCommand("behaveRunner.cancelRun");
    return;
  }
  if (msg.type === "rerunLastRun") {
    await vscode.commands.executeCommand("behaveRunner.rerunLastRun");
    return;
  }
  if (msg.type !== "revealStep") {
    return;
  }
  const fsPath =
    typeof msg.path === "string"
      ? msg.path
      : typeof msg.gotoPath === "string"
        ? msg.gotoPath
        : "";
  let lineRaw = NaN;
  if (typeof msg.line === "number" && Number.isFinite(msg.line)) {
    lineRaw = Math.floor(msg.line);
  } else if (typeof msg.gotoLine === "number" && Number.isFinite(msg.gotoLine)) {
    lineRaw = Math.floor(msg.gotoLine);
  } else if (typeof msg.line === "string") {
    const n = Number.parseInt(msg.line, 10);
    lineRaw = Number.isNaN(n) ? NaN : n;
  } else if (typeof msg.gotoLine === "string") {
    const n = Number.parseInt(msg.gotoLine, 10);
    lineRaw = Number.isNaN(n) ? NaN : n;
  }
  if (!fsPath || Number.isNaN(lineRaw)) {
    return;
  }
  const line0 = Math.max(0, lineRaw);
  try {
    const uri = vscode.Uri.file(fsPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const capped = Math.min(line0, Math.max(0, doc.lineCount - 1));
    const pos = doc.lineAt(capped).range.start;
    await vscode.window.showTextDocument(doc, {
      selection: new vscode.Selection(pos, pos),
      preserveFocus: false,
      preview: false
    });
  } catch {
    /* file missing or inaccessible */
  }
}
