import type { LivePanelToWebviewMessage } from "../ui/livePanelProtocol";

/** Live run webview + capture persistence. */
export interface LiveRunPanelSink {
  post(message: LivePanelToWebviewMessage): void;
  clear(): void;
  persistCapture(): void;
}

export interface RunOutputSink {
  append(text: string): void;
}

export interface BehaveRunSinks {
  livePanel: LiveRunPanelSink;
  output: RunOutputSink;
}
