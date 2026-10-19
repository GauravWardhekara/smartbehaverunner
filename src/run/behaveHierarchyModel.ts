import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { parseFeatureFile, type ParsedStep } from "../core";

const hierarchyChangeListeners = new Set<() => void>();

/** When `.feature` roots change; e.g. CodeLens refresh. */
export function subscribeBehaveHierarchyChanges(
  listener: () => void
): vscode.Disposable {
  hierarchyChangeListeners.add(listener);
  return new vscode.Disposable(() => hierarchyChangeListeners.delete(listener));
}

function notifyBehaveHierarchyChanged(): void {
  for (const listener of hierarchyChangeListeners) {
    listener();
  }
}

export const FEATURE_PREFIX = "behave:feat:";
export const SCEN_PREFIX = "behave:scen:";
export const BG_PREFIX = "behave:bg:";

export function featureId(fsPath: string): string {
  return FEATURE_PREFIX + encodeURIComponent(fsPath);
}

export type BehaveHierarchyNode = {
  id: string;
  label: string;
  uri: vscode.Uri;
  range?: vscode.Range;
  parent: BehaveHierarchyNode | undefined;
  readonly children: Map<string, BehaveHierarchyNode>;
  canResolveChildren: boolean;
  error?: string;
  /** 0-based line of `Scenario Outline:` for rows expanded from that outline (Run all). */
  outlineHeaderLine?: number;
};

function createNode(
  id: string,
  label: string,
  uri: vscode.Uri,
  parent: BehaveHierarchyNode | undefined,
  canResolveChildren: boolean
): BehaveHierarchyNode {
  return {
    id,
    label,
    uri,
    parent,
    children: new Map(),
    canResolveChildren
  };
}

function rangeForContentLine(lines: string[], line: number): vscode.Range {
  const lineLen = lines[line]?.length ?? 0;
  return new vscode.Range(line, 0, line, Math.max(0, lineLen));
}

function addStepsToSuiteItem(
  suiteItem: BehaveHierarchyNode,
  steps: ParsedStep[],
  uri: vscode.Uri
): void {
  for (const [index, st] of steps.entries()) {
    const stepItem = createNode(
      `${suiteItem.id}::step:${index}:L${st.line}`,
      `${st.keyword} ${st.text}`,
      uri,
      suiteItem,
      false
    );
    suiteItem.children.set(stepItem.id, stepItem);
  }
}

export async function resolveFeatureChildren(
  featureItem: BehaveHierarchyNode
): Promise<void> {
  const uri = featureItem.uri;
  const fsPath = uri.fsPath;
  const content = await fs.promises.readFile(fsPath, "utf-8");
  const parsed = parseFeatureFile(fsPath, content);
  const basename = path.basename(fsPath);
  const lines = content.split("\n");
  featureItem.label = parsed.name ? `${basename} — ${parsed.name}` : basename;
  featureItem.range = rangeForContentLine(lines, parsed.line);
  featureItem.error = undefined;

  featureItem.children.clear();

  if (parsed.background && parsed.background.steps.length > 0) {
    const bgItem = createNode(
      BG_PREFIX + encodeURIComponent(fsPath),
      "Background",
      uri,
      featureItem,
      false
    );
    addStepsToSuiteItem(bgItem, parsed.background.steps, uri);
    featureItem.children.set(bgItem.id, bgItem);
  }

  for (const sc of parsed.scenarios) {
    if (sc.isOutline && sc.outlineExpansions && sc.outlineExpansions.length > 0) {
      for (const ex of sc.outlineExpansions) {
        const sci = createNode(
          SCEN_PREFIX + encodeURIComponent(fsPath) + ":" + String(ex.line),
          ex.behaveName,
          uri,
          featureItem,
          false
        );
        sci.range = rangeForContentLine(lines, ex.line);
        sci.outlineHeaderLine = sc.line;
        addStepsToSuiteItem(sci, sc.steps, uri);
        featureItem.children.set(sci.id, sci);
      }
    } else {
      const sci = createNode(
        SCEN_PREFIX + encodeURIComponent(fsPath) + ":" + String(sc.line),
        sc.name,
        uri,
        featureItem,
        false
      );
      sci.range = rangeForContentLine(lines, sc.line);
      addStepsToSuiteItem(sci, sc.steps, uri);
      featureItem.children.set(sci.id, sci);
    }
  }

  featureItem.canResolveChildren = false;
}

/** Scenario nodes created from one Scenario Outline (same `outlineHeaderLine`). */
export function listOutlineExpansionsForHeader(
  featureItem: BehaveHierarchyNode,
  outlineHeaderLine0: number
): BehaveHierarchyNode[] {
  const out: BehaveHierarchyNode[] = [];
  for (const ch of featureItem.children.values()) {
    if (!ch.id.startsWith(SCEN_PREFIX)) {
      continue;
    }
    if (ch.outlineHeaderLine === outlineHeaderLine0) {
      out.push(ch);
    }
  }
  out.sort(
    (a, b) => (a.range?.start.line ?? 0) - (b.range?.start.line ?? 0)
  );
  return out;
}

export async function resolveBehaveFeatureChildrenIfNeeded(
  featureItem: BehaveHierarchyNode
): Promise<void> {
  if (!featureItem.id.startsWith(FEATURE_PREFIX)) {
    return;
  }
  if (featureItem.children.size > 0 && !featureItem.canResolveChildren) {
    return;
  }
  try {
    await resolveFeatureChildren(featureItem);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    featureItem.error = msg;
  }
}

export class BehaveHierarchyStore {
  private readonly roots = new Map<string, BehaveHierarchyNode>();

  getFeatureByFsPath(fsPath: string): BehaveHierarchyNode | undefined {
    return this.roots.get(featureId(fsPath));
  }

  getAllFeatures(): BehaveHierarchyNode[] {
    return Array.from(this.roots.values());
  }

  /**
   * Ensures a hierarchy root for an on-disk `.feature` under the open workspace.
   * Run/debug from CodeLens already targets this file; no second “inclusion” gate.
   * Do not re-add `featureFiles.patterns` / LSP parity checks here — see
   * `.cursor/rules/behave-runner-language-split.mdc`.
   */
  async ensureFeatureRoot(fsPath: string): Promise<BehaveHierarchyNode | undefined> {
    const existing = this.getFeatureByFsPath(fsPath);
    if (existing) {
      return existing;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      return undefined;
    }

    const normalized = path.normalize(fsPath);
    const underWorkspace = folders.some((f) => {
      const rel = path.relative(f.uri.fsPath, normalized);
      return !rel.startsWith("..") && !path.isAbsolute(rel);
    });
    if (!underWorkspace) {
      return undefined;
    }

    try {
      await fs.promises.access(normalized);
    } catch {
      return undefined;
    }

    const uri = vscode.Uri.file(normalized);
    const id = featureId(normalized);
    const node = createNode(id, path.basename(normalized), uri, undefined, true);
    this.roots.set(id, node);
    notifyBehaveHierarchyChanged();
    return node;
  }

  removeFeatureByFsPath(fsPath: string): void {
    const id = featureId(fsPath);
    this.roots.delete(id);
    notifyBehaveHierarchyChanged();
  }

  invalidateFeature(fsPath: string): void {
    const id = featureId(fsPath);
    const existing = this.roots.get(id);
    if (existing) {
      existing.children.clear();
      existing.canResolveChildren = true;
      existing.error = undefined;
      notifyBehaveHierarchyChanged();
    }
  }
}

export function registerBehaveHierarchyStore(
  context: vscode.ExtensionContext
): BehaveHierarchyStore {
  const store = new BehaveHierarchyStore();

  const featureWatcher = vscode.workspace.createFileSystemWatcher("**/*.feature");
  const debounceByPath = new Map<string, NodeJS.Timeout>();

  const scheduleRefresh = (uri: vscode.Uri): void => {
    const key = uri.fsPath;
    const prev = debounceByPath.get(key);
    if (prev) {
      clearTimeout(prev);
    }
    debounceByPath.set(
      key,
      setTimeout(() => {
        debounceByPath.delete(key);
        if (store.getFeatureByFsPath(key)) {
          store.invalidateFeature(key);
        } else {
          void store.ensureFeatureRoot(key);
        }
      }, 250)
    );
  };

  featureWatcher.onDidChange((uri) => scheduleRefresh(uri));
  featureWatcher.onDidCreate(async (uri) => {
    await store.ensureFeatureRoot(uri.fsPath);
    scheduleRefresh(uri);
  });
  featureWatcher.onDidDelete((uri) => {
    store.removeFeatureByFsPath(uri.fsPath);
  });

  context.subscriptions.push(featureWatcher);

  return store;
}
