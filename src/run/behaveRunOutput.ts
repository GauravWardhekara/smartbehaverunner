import * as vscode from "vscode";
import { normalizeToCrlfChunk } from "../utils/normalizeCrlf";

let behaveOutputChannel: vscode.OutputChannel | undefined;

export function getBehaveOutputChannel(): vscode.OutputChannel {
  if (!behaveOutputChannel) {
    behaveOutputChannel = vscode.window.createOutputChannel("Behave");
  }
  return behaveOutputChannel;
}

export function appendRunOutput(text: string): void {
  getBehaveOutputChannel().append(normalizeToCrlfChunk(text));
}

export function registerBehaveOutputChannel(
  context: vscode.ExtensionContext
): void {
  context.subscriptions.push(getBehaveOutputChannel());
}
