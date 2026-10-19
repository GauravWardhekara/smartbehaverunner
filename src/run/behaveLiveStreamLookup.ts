import {
  BG_PREFIX,
  type BehaveHierarchyNode,
  SCEN_PREFIX
} from "./behaveHierarchyModel";
import {
  normalizeScenarioName,
  parseBehaveLocation,
  pathsEqualFs,
  stripOutlineSuffix
} from "./behaveLiveStreamPaths";

/** 0-based line in `behave:scen:<encPath>:<line>` ids (Examples row or scenario keyword line). */
export function scenarioAnchorLine0FromScenarioNode(
  ch: BehaveHierarchyNode
): number | undefined {
  if (!ch.id.startsWith(SCEN_PREFIX)) {
    return undefined;
  }
  const rest = ch.id.slice(SCEN_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0) {
    return undefined;
  }
  const lineStr = rest.slice(lastColon + 1);
  const sl = parseInt(lineStr, 10);
  return Number.isFinite(sl) ? sl : undefined;
}

/** True when Behave's `file:line` location refers to this scenario node's anchor or range. */
export function scenarioNodeMatchesBehaveLocation(
  scenarioNode: BehaveHierarchyNode,
  locationStr: string | undefined,
  jobFsPath: string,
  workspaceRoot: string
): boolean {
  const loc = parseBehaveLocation(locationStr);
  if (!loc || !pathsEqualFs(loc.filePath, jobFsPath, workspaceRoot)) {
    return false;
  }
  const line0 = loc.line1Based - 1;
  const anchor = scenarioAnchorLine0FromScenarioNode(scenarioNode);
  if (anchor !== undefined && anchor === line0) {
    return true;
  }
  const r = scenarioNode.range?.start.line;
  return r !== undefined && r === line0;
}

/** Count scenario children whose outline base title (after ` -- @…`) matches. */
export function countScenariosWithStrippedOutlineName(
  featureItem: BehaveHierarchyNode,
  strippedNormalized: string
): number {
  let n = 0;
  for (const ch of featureItem.children.values()) {
    if (!ch.id.startsWith(SCEN_PREFIX)) {
      continue;
    }
    if (normalizeScenarioName(stripOutlineSuffix(ch.label)) === strippedNormalized) {
      n += 1;
    }
  }
  return n;
}

function disambiguateScenariosByLocation(
  candidates: BehaveHierarchyNode[],
  locationStr: string | undefined,
  jobFsPath: string,
  workspaceRoot: string
): BehaveHierarchyNode | undefined {
  const loc = parseBehaveLocation(locationStr);
  if (!loc || !pathsEqualFs(loc.filePath, jobFsPath, workspaceRoot)) {
    return undefined;
  }
  const line0 = loc.line1Based - 1;
  const byIdLine = candidates.filter(
    (ch) => scenarioAnchorLine0FromScenarioNode(ch) === line0
  );
  if (byIdLine.length === 1) {
    return byIdLine[0];
  }
  const byRange = candidates.filter((ch) => ch.range?.start.line === line0);
  if (byRange.length === 1) {
    return byRange[0];
  }
  return undefined;
}

/** 0-based line from ids shaped like `...::step:0:L42` */
function lineFromEncodedStepId(id: string): number | undefined {
  const m = id.match(/::step:\d+:L(\d+)$/);
  if (!m) {
    return undefined;
  }
  const line = parseInt(m[1], 10);
  return Number.isFinite(line) ? line : undefined;
}

export function findBgItem(
  featureItem: BehaveHierarchyNode
): BehaveHierarchyNode | undefined {
  for (const ch of featureItem.children.values()) {
    if (ch.id.startsWith(BG_PREFIX)) {
      return ch;
    }
  }
  return undefined;
}

export function findStepUnderParent(
  parent: BehaveHierarchyNode,
  jobFsPath: string,
  line0Based: number,
  workspaceRoot: string
): BehaveHierarchyNode | undefined {
  for (const step of parent.children.values()) {
    if (!step.id.includes("::step:")) {
      continue;
    }
    const uri = step.uri;
    if (!uri || !pathsEqualFs(uri.fsPath, jobFsPath, workspaceRoot)) {
      continue;
    }
    if (lineFromEncodedStepId(step.id) === line0Based) {
      return step;
    }
  }
  return undefined;
}

export function findScenarioItem(
  featureItem: BehaveHierarchyNode,
  elementName: string,
  locationStr: string | undefined,
  jobFsPath: string,
  workspaceRoot: string
): BehaveHierarchyNode | undefined {
  const normEl = normalizeScenarioName(elementName);
  const scenChildren: BehaveHierarchyNode[] = [];
  for (const ch of featureItem.children.values()) {
    if (ch.id.startsWith(SCEN_PREFIX)) {
      scenChildren.push(ch);
    }
  }

  // Match Behave's expanded `scenario` string first. Location-only matching used to run
  // before this and could attach steps to the wrong outline when example/step lines
  // lined up across different Scenario Outline blocks (dynamic Examples).

  const nameMatches = scenChildren.filter(
    (ch) => normalizeScenarioName(ch.label) === normEl
  );
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }
  if (nameMatches.length > 1) {
    const pick = disambiguateScenariosByLocation(
      nameMatches,
      locationStr,
      jobFsPath,
      workspaceRoot
    );
    if (pick) {
      return pick;
    }
  }

  const wantStrip = normalizeScenarioName(stripOutlineSuffix(elementName));
  const stripMatches = scenChildren.filter(
    (ch) => normalizeScenarioName(stripOutlineSuffix(ch.label)) === wantStrip
  );
  if (stripMatches.length === 1) {
    return stripMatches[0];
  }
  if (stripMatches.length > 1) {
    const pick = disambiguateScenariosByLocation(
      stripMatches,
      locationStr,
      jobFsPath,
      workspaceRoot
    );
    if (pick) {
      return pick;
    }
  }

  return undefined;
}
