import {
  listOutlineExpansionsForHeader,
  resolveBehaveFeatureChildrenIfNeeded,
  SCEN_PREFIX,
  type BehaveHierarchyStore,
  type BehaveHierarchyNode
} from "./behaveHierarchyModel";

export async function getFeatureHierarchyNodeForPath(
  store: BehaveHierarchyStore,
  fsPath: string
): Promise<BehaveHierarchyNode | undefined> {
  let feature = store.getFeatureByFsPath(fsPath);
  if (!feature) {
    feature = await store.ensureFeatureRoot(fsPath);
  }
  return feature;
}

export async function getScenarioNodeAtLine(
  store: BehaveHierarchyStore,
  fsPath: string,
  scenarioLine: number
): Promise<BehaveHierarchyNode | undefined> {
  const feature = await getFeatureHierarchyNodeForPath(store, fsPath);
  if (!feature) {
    return undefined;
  }
  await resolveBehaveFeatureChildrenIfNeeded(feature);
  const id =
    SCEN_PREFIX + encodeURIComponent(fsPath) + ":" + String(scenarioLine);
  return feature.children.get(id);
}

export async function getScenarioOutlineExpansionNodes(
  store: BehaveHierarchyStore,
  fsPath: string,
  outlineHeaderLine0: number
): Promise<BehaveHierarchyNode[]> {
  const feature = await getFeatureHierarchyNodeForPath(store, fsPath);
  if (!feature) {
    return [];
  }
  await resolveBehaveFeatureChildrenIfNeeded(feature);
  return listOutlineExpansionsForHeader(feature, outlineHeaderLine0);
}
