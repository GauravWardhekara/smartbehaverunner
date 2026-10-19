/**
 * Public API of @behave-runner/core. Symbols not listed here are internal implementation details.
 */

export type {
  FeatureStep,
  StepDefinition,
  StepInfo,
  StepKeyword,
} from "./types";

export type {
  ParsedBackground,
  ParsedFeature,
  ParsedOutlineExpansion,
  ParsedScenario,
  ParsedStep,
} from "./featureParser";
export { parseFeatureFile } from "./featureParser";

export type {
  AnalyzeFeatureDocumentResult,
  FeatureSemanticTokenKind,
  FeatureSemanticTokenSpan,
  FeatureUndefinedStepDiagnostic,
} from "./featureSemanticTokens";
export {
  analyzeFeatureDocument,
  computeFeatureSemanticTokenSpans,
} from "./featureSemanticTokens";

export {
  behavePatternToCaptureRegex,
  behavePatternToRegex,
  capturePlaceholderRangesFromBehavePattern,
  findMatchingDefinitions,
  matchesStepDefinition,
  parseStepLine,
  parseStepLinePrefixForCompletion,
  resolveEffectiveKeyword,
} from "./stepMatcher";

export {
  DEFAULT_STEP_DEFINITION_PATTERNS,
  parseStepDefinitionsFromPython,
} from "./pythonStepDecorators";

export {
  DEFAULT_FEATURE_FILE_PATTERNS,
  extractFeatureStepsFromContent,
} from "./featureSteps";

export {
  collectBehaveStepDecoratorsAboveFunction,
  isPythonFunctionDefinitionLine,
} from "./pythonStepDecoratorScan";

export {
  BEHAVE_FIND_FEATURE_STEP_LOCATIONS,
  type BehaveFindFeatureStepLocationsParams,
} from "./lspBehaveRpc";

export {
  computeFeatureFormatLineEdits,
  type FeatureFormatOptions,
  type FeatureLineEdit,
} from "./featureFormat";

export { escapeBehaveNameSelect } from "./behaveNameSelect";
