/** Custom LSP JSON-RPC method: Python step → locations in `.feature` files. */
export const BEHAVE_FIND_FEATURE_STEP_LOCATIONS = "behave/findFeatureStepLocations";

export interface BehaveFindFeatureStepLocationsParams {
  /** 0-based line of the `def ...` step implementation. */
  functionLine: number;
  /** Full document text (normalized newlines as `\n`). */
  text: string;
}
