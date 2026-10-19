export interface BehaveTestRunReporter {
  onScenarioStarted(fsPath: string, scenarioName?: string, locationStr?: string): void;
  onStepFinished(
    fsPath: string,
    scenarioName?: string,
    locationStr?: string,
    keyword?: string,
    stepText?: string,
    status?: string,
    error?: string
  ): void;
  onScenarioFinished(
    fsPath: string,
    scenarioName?: string,
    locationStr?: string,
    status?: string
  ): void;
  onFeatureFinished(
    fsPath: string,
    featureName?: string,
    status?: string
  ): void;
  onRunFinished(exitCode: number): void;
  dispose(): void;
}
