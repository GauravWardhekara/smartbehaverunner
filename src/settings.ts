import { workspace, WorkspaceFolder, Uri } from "vscode";

function setting<T>(name: string, fallbackName?: string, defaultValue?: T)
{
    return (resource?: WorkspaceFolder | Uri | string) =>
    {
        const uri = typeof resource === "string" 
            ? Uri.file(resource) 
            : (resource && "uri" in resource ? resource.uri : resource);

        // 1. Check smartBehave.*
        const smartConfig = workspace.getConfiguration("smartBehave", uri);
        const smartValue = smartConfig.get<T>(name);
        if (smartValue !== undefined && smartValue !== null)
        {
            return smartValue;
        }

        // 2. Check behave.*
        const config = workspace.getConfiguration("behave", uri);
        const value = config.get<T>(name);
        if (value !== undefined && value !== null)
        {
            return value;
        }

        // 3. Check legacy behaveRunner.*
        if (fallbackName)
        {
            const legacyConfig = workspace.getConfiguration("behaveRunner", uri);
            const legacyValue = legacyConfig.get<T>(fallbackName);
            if (legacyValue !== undefined && legacyValue !== null)
            {
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
    featureFilesPatterns: setting<string[]>("featureFiles.patterns", "featureFiles.patterns", ["**/*.feature"]),
    stepDefinitionsPatterns: setting<string[]>("stepDefinitions.patterns", "stepDefinitions.patterns", [
        "**/steps/**/*.py",
        "**/*_steps.py",
        "**/step_*.py",
        "**/steps.py",
    ]),
    codeLens: setting<boolean>("codeLens", undefined, false),
    justMyCode: setting<boolean>("debug.justMyCode", "debug.justMyCode", true),
    livePanelEnabled: setting<boolean>("livePanel.enabled", undefined, true),
    configDirectory: setting<string>("configDirectory", "configDirectory", "configs"),
    defaultConfigFile: setting<string>("defaultConfigFile", "defaultConfigFile", ""),
};
