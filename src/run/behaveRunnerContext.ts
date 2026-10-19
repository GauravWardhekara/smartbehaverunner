import * as vscode from "vscode";
import type { BehaveHierarchyStore } from "./behaveHierarchyModel";
import { appendRunOutput } from "./behaveRunOutput";
import type { BehaveRunSinks } from "./behaveRunPorts";
import {
  isLivePanelToWebviewMessage,
  type LivePanelToWebviewMessage
} from "../ui/livePanelProtocol";

/** Composition root: paths, hierarchy store, and run I/O sinks (set once from `activate`). */
export interface BehaveRunnerContext {
  readonly extensionUri: vscode.Uri;
  readonly extensionPath: string;
  readonly hierarchyStore: BehaveHierarchyStore;
  readonly runSinks: BehaveRunSinks;
}

export interface LiveRunPanelGateway {
  post(message: LivePanelToWebviewMessage): void;
  clear(): void;
  persistCapture(): void;
}

let behaveRunnerContext: BehaveRunnerContext | undefined;
let liveRunPanelGateway: LiveRunPanelGateway | undefined;

export function setBehaveRunnerContext(
  next: BehaveRunnerContext | undefined
): void {
  behaveRunnerContext = next;
}

export function getBehaveRunnerContext(): BehaveRunnerContext | undefined {
  return behaveRunnerContext;
}

export function setLiveRunPanelGateway(
  gateway: LiveRunPanelGateway | undefined
): void {
  liveRunPanelGateway = gateway;
}

export function postLiveRunMessage(message: LivePanelToWebviewMessage): void {
  if (!isLivePanelToWebviewMessage(message)) {
    return;
  }
  liveRunPanelGateway?.post(message);
}

export function clearLiveRunPanel(): void {
  liveRunPanelGateway?.clear();
}

export function persistLivePanelCaptureNow(): void {
  liveRunPanelGateway?.persistCapture();
}

export function createBehaveRunSinks(): BehaveRunSinks {
  return {
    livePanel: {
      post: (m) => postLiveRunMessage(m),
      clear: () => clearLiveRunPanel(),
      persistCapture: () => persistLivePanelCaptureNow()
    },
    output: {
      append: (t) => appendRunOutput(t)
    }
  };
}

export function getBehaveRunnerExtensionPath(): string {
  return behaveRunnerContext?.extensionPath ?? "";
}

export function getBehaveHierarchyStoreRef():
  | BehaveHierarchyStore
  | undefined {
  return behaveRunnerContext?.hierarchyStore;
}
