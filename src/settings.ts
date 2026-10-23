import { workspace, WorkspaceFolder, Uri } from "vscode";

function setting<T>(name: string, fallbackName?: string, defaultValue?: T) {
  return (resource?: WorkspaceFolder | Uri | string): T => {
    const uri =
      typeof resource === "string"
        ? Uri.file(resource)
        : resource && "uri" in resource
        ? resource.uri
        : resource;

    // 1. Check smartBehave.*
    const smartConfig = workspace.getConfiguration("smartBehave", uri);
    const smartValue = smartConfig.get<T>(name);
    if (smartValue !== undefined && smartValue !== null) {
      return smartValue;
    }

    // 2. Check behave.*
    const config = workspace.getConfiguration("behave", uri);
    const value = config.get<T>(name);
    if (value !== undefined && value !== null) {
      return value;
    }

    // 3. Check legacy behaveRunner.*
    if (fallbackName) {
      const legacyConfig = workspace.getConfiguration("behaveRunner", uri);
      const legacyValue = legacyConfig.get<T>(fallbackName);
      if (legacyValue !== undefined && legacyValue !== null) {
        return legacyValue;
      }
    }

    return defaultValue as T;
  };
}

export const settings = {
  arguments: setting<string[]>("arguments", undefined, ["-f", "pretty"]),
  extraArgs: setting<string[]>("extraArgs", "behave.extraArgs", []),
  autoDiscover: setting<boolean>("autoDiscover", undefined, true),
  diffRegex: setting<string[]>("diffRegex", undefined, [
    "Expected: (?<expected>.*)[\\s\\S]*but: was (?<actual>.*)",
  ]),
  allowedFiles: setting<string>("allowedFiles", undefined, "**/*.feature"),
  featureFilesPatterns: setting<string[]>(
    "featureFiles.patterns",
    "featureFiles.patterns",
    ["**/*.feature"]
  ),
  stepDefinitionsPatterns: setting<string[]>(
    "stepDefinitions.patterns",
    "stepDefinitions.patterns",
    [
      "**/steps/**/*.py",
      "**/*_steps.py",
      "**/step_*.py",
      "**/steps.py",
    ]
  ),
  codeLens: setting<boolean>("codeLens", undefined, false),
  justMyCode: setting<boolean>("debug.justMyCode", "debug.justMyCode", true),
  livePanelEnabled: setting<boolean>("livePanel.enabled", undefined, true),
  configDirectory: setting<string>("configDirectory", "configDirectory", "configs"),
  defaultConfigFile: setting<string>("defaultConfigFile", "defaultConfigFile", ""),

  // Custom Gherkin Formatter Settings
  formatting: {
    customIndentEnabled: setting<boolean>("formatting.customIndent.enabled", undefined, true),
    indentCharacter: setting<string>("formatting.indentCharacter", undefined, "auto"),
    indentFeature: setting<number>("formatting.indent.feature", undefined, 0),
    indentScenario: setting<number>("formatting.indent.scenario", undefined, 1),
    indentBackground: setting<number>("formatting.indent.background", undefined, 1),
    indentRule: setting<number>("formatting.indent.rule", undefined, 1),
    indentExamples: setting<number>("formatting.indent.examples", undefined, 2),
    indentGiven: setting<number>("formatting.indent.given", undefined, 2),
    indentWhen: setting<number>("formatting.indent.when", undefined, 2),
    indentThen: setting<number>("formatting.indent.then", undefined, 3),
    indentAnd: setting<number>("formatting.indent.and", undefined, 4),
    indentBut: setting<number>("formatting.indent.but", undefined, 4),
    indentStar: setting<number>("formatting.indent.star", undefined, 2),
    relativeAnd: setting<boolean>("formatting.relativeAnd", undefined, false),
  },

  // Cucumber Language Server Settings
  cucumber: {
    features: (resource?: WorkspaceFolder | Uri | string): string[] => {
      const uri =
        typeof resource === "string"
          ? Uri.file(resource)
          : resource && "uri" in resource
          ? resource.uri
          : resource;
      return workspace.getConfiguration("cucumber", uri).get<string[]>("features", [
        "src/test/**/*.feature",
        "features/**/*.feature",
        "tests/**/*.feature",
        "*specs*/**/*.feature",
      ]);
    },
    glue: (resource?: WorkspaceFolder | Uri | string): string[] => {
      const uri =
        typeof resource === "string"
          ? Uri.file(resource)
          : resource && "uri" in resource
          ? resource.uri
          : resource;
      return workspace.getConfiguration("cucumber", uri).get<string[]>("glue", [
        "*specs*/**/*.cs",
        "features/**/*.js",
        "features/**/*.jsx",
        "features/**/*.php",
        "features/**/*.py",
        "features/**/*.rs",
        "features/**/*.rb",
        "features/**/*.ts",
        "features/**/*.tsx",
        "features/**/*_test.go",
        "src/test/**/*.java",
        "tests/**/*.py",
        "tests/**/*.rs",
        "**/steps/**/*.py",
        "steps/**/*.py",
        "**/*_steps.py",
        "**/step_*.py",
        "**/steps.py",
      ]);
    },
    parameterTypes: (resource?: WorkspaceFolder | Uri | string): any[] => {
      const uri =
        typeof resource === "string"
          ? Uri.file(resource)
          : resource && "uri" in resource
          ? resource.uri
          : resource;
      return workspace.getConfiguration("cucumber", uri).get<any[]>("parameterTypes", []);
    },
  },
};
