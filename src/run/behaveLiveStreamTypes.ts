import type { BehaveHierarchyNode } from "./behaveHierarchyModel";

export type LiveStreamJob =
  | { kind: "feature" }
  | {
      kind: "scenario";
      scenarioName: string;
      scenarioItem: BehaveHierarchyNode;
    };

export type LiveStreamEvent =
  | {
      event: "scenario_started";
      feature?: string;
      scenario?: string;
      location?: string;
    }
  | {
      event: "scenario_finished";
      feature?: string;
      scenario?: string;
      location?: string;
      status?: string;
    }
  | {
      event: "feature_finished";
      feature?: string;
      status?: string;
    }
  | {
      event: "step_started";
      feature?: string;
      scenario?: string;
      location?: string;
      keyword?: string;
      step?: string;
    }
  | {
      event: "step_finished";
      feature?: string;
      scenario?: string;
      location?: string;
      keyword?: string;
      step?: string;
      status?: string;
      error?: string | null;
    };
