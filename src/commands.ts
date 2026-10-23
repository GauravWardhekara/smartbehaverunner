import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LOG } from "./log";
import {
  cancelActiveBehaveRun,
  isBehaveRunActive,
  logBehaveRunCancel
} from "./run/behaveRunCancellation";
import { rerunLastBehaveRun } from "./run/behaveRunRerun";
import {
  runBehaveHierarchyDebugSelection,
  runBehaveHierarchySelection
} from "./run/behaveRunExecution";
import {
  getFeatureHierarchyNodeForPath,
  getScenarioNodeAtLine
} from "./run/behaveHierarchyQueries";
import {
  getBehaveHierarchyStoreRef,
  getBehaveRunnerContext
} from "./run/behaveRunnerContext";
import {
  buildPythonBehaveDebugLaunchFromCliArgs,
  getJustMyCodeForResource
} from "./run/behavePythonDebug";
import { promptOrResolveCapsFile } from "./run/behaveConfigFile";
import { behaveTestController } from "./testController";
import { stepDefinitionIndex } from "./language/stepIndex";
import { featureStepIndex } from "./language/featureStepIndex";
import { revealLiveRunPanel, openMainScreenPanel } from "./ui/liveRunWebview";
import { executeGenerateStepDefinition, GeneratedStepSnippet } from "./language/stepCodeActionProvider";
import { behaveResultsManager } from "./run/behaveResultsManager";

type RunScenarioArgs = {
  filePath: string;
  scenarioName?: string;
  runAll: boolean;
  workspaceRoot: string;
};

export function registerCommands(context: vscode.ExtensionContext): void {
  const store = getBehaveHierarchyStoreRef();

  // Run whole feature or active file
  const runActive = async () => {
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (!activeDoc || !activeDoc.fileName.endsWith(".feature")) {
      await behaveTestController.discoverAll();
      return;
    }
    const currentStore = getBehaveHierarchyStoreRef();
    if (!currentStore) return;
    const node = await getFeatureHierarchyNodeForPath(currentStore, activeDoc.fileName);
    if (node) {
      const cts = new vscode.CancellationTokenSource();
      try {
        await runBehaveHierarchySelection([node], cts.token);
      } finally {
        cts.dispose();
      }
    }
  };

  const debugActive = async () => {
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (!activeDoc || !activeDoc.fileName.endsWith(".feature")) {
      return;
    }
    const currentStore = getBehaveHierarchyStoreRef();
    if (!currentStore) return;
    const node = await getFeatureHierarchyNodeForPath(currentStore, activeDoc.fileName);
    if (node) {
      const cts = new vscode.CancellationTokenSource();
      try {
        await runBehaveHierarchyDebugSelection([node], cts.token);
      } finally {
        cts.dispose();
      }
    }
  };

  const cancelRun = async () => {
    if (!isBehaveRunActive()) {
      void vscode.window.showInformationMessage("No active Behave test is currently running.");
      return;
    }
    const selection = await vscode.window.showWarningMessage(
      "Are you sure you want to stop the running Behave test?",
      { modal: true },
      "Yes, Stop Test"
    );
    if (selection === "Yes, Stop Test") {
      logBehaveRunCancel("command behave.cancelRun confirmed by user");
      const ctx = getBehaveRunnerContext();
      ctx?.runSinks.livePanel.post({
        type: "raw_log",
        text: "\r\n\x1b[33m[Smart Behave] Stop requested by user. Terminating test process...\x1b[0m\r\n"
      });
      cancelActiveBehaveRun();
      void vscode.window.showInformationMessage("Behave test execution stopped.");
    }
  };

  const rerunLast = async () => {
    await rerunLastBehaveRun();
  };

  const runWithTags = async () => {
    const input = await vscode.window.showInputBox({
      prompt: "Enter Behave tag expression (e.g. '@smoke', '@wip', '@smoke and not @slow')",
      placeHolder: "@smoke and not @slow"
    });
    if (!input || !input.trim()) return;
    const tagExpr = input.trim();
    const activeDoc = vscode.window.activeTextEditor?.document;
    const currentStore = getBehaveHierarchyStoreRef();
    if (!currentStore) return;
    let nodes: any[] = [];
    if (activeDoc && activeDoc.fileName.endsWith(".feature")) {
      const node = await getFeatureHierarchyNodeForPath(currentStore, activeDoc.fileName);
      if (node) nodes = [node];
    }
    if (nodes.length === 0) {
      nodes = currentStore.getAllFeatures();
    }
    if (nodes.length === 0) return;
    const cts = new vscode.CancellationTokenSource();
    try {
      await runBehaveHierarchySelection(nodes, cts.token, undefined, ["--tags", tagExpr]);
    } finally {
      cts.dispose();
    }
  };

  const runDryRun = async () => {
    const activeDoc = vscode.window.activeTextEditor?.document;
    const currentStore = getBehaveHierarchyStoreRef();
    if (!currentStore) return;
    let nodes: any[] = [];
    if (activeDoc && activeDoc.fileName.endsWith(".feature")) {
      const node = await getFeatureHierarchyNodeForPath(currentStore, activeDoc.fileName);
      if (node) nodes = [node];
    }
    if (nodes.length === 0) {
      nodes = currentStore.getAllFeatures();
    }
    if (nodes.length === 0) return;
    const cts = new vscode.CancellationTokenSource();
    try {
      await runBehaveHierarchySelection(nodes, cts.token, undefined, ["--dry-run"]);
    } finally {
      cts.dispose();
    }
  };

  const runWip = async () => {
    const activeDoc = vscode.window.activeTextEditor?.document;
    const currentStore = getBehaveHierarchyStoreRef();
    if (!currentStore) return;
    let nodes: any[] = [];
    if (activeDoc && activeDoc.fileName.endsWith(".feature")) {
      const node = await getFeatureHierarchyNodeForPath(currentStore, activeDoc.fileName);
      if (node) nodes = [node];
    }
    if (nodes.length === 0) {
      nodes = currentStore.getAllFeatures();
    }
    if (nodes.length === 0) return;
    const cts = new vscode.CancellationTokenSource();
    try {
      await runBehaveHierarchySelection(nodes, cts.token, undefined, ["--wip"]);
    } finally {
      cts.dispose();
    }
  };

  const openEnvironmentFile = async () => {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
      void vscode.window.showErrorMessage("No workspace folder open.");
      return;
    }
    const root = wsFolders[0].uri.fsPath;
    const envPath = path.join(root, "features", "environment.py");
    if (fs.existsSync(envPath)) {
      const doc = await vscode.workspace.openTextDocument(envPath);
      await vscode.window.showTextDocument(doc);
    } else {
      const ans = await vscode.window.showInformationMessage(
        "features/environment.py does not exist yet. Would you like to create it with Behave hooks and fixtures?",
        "Yes, Create environment.py",
        "Cancel"
      );
      if (ans === "Yes, Create environment.py") {
        const template = [
          "# -*- coding: utf-8 -*-",
          '"""Behave test lifecycle environment hooks and fixtures."""',
          "from behave import fixture, use_fixture",
          "",
          "def before_all(context):",
          '    """Runs once before any feature or scenario executes."""',
          "    context.base_url = 'https://example.com'",
          "",
          "def before_feature(context, feature):",
          '    """Runs before each feature file is evaluated."""',
          "    pass",
          "",
          "def before_scenario(context, scenario):",
          '    """Runs before each scenario executes."""',
          "    pass",
          "",
          "def before_step(context, step):",
          '    """Runs before each step executes."""',
          "    pass",
          "",
          "def after_step(context, step):",
          '    """Runs after each step executes."""',
          '    if step.status == \"failed\":',
          "        pass",
          "",
          "def after_scenario(context, scenario):",
          '    """Runs after each scenario executes."""',
          "    pass",
          "",
          "def after_feature(context, feature):",
          '    """Runs after each feature file completes."""',
          "    pass",
          "",
          "def after_all(context):",
          '    """Runs once after all features have finished execution."""',
          "    pass",
          "",
          "def before_tag(context, tag):",
          '    """Runs before tags to attach fixtures or conditional setup."""',
          "    pass",
          ""
        ].join("\n");
        const featuresDir = path.join(root, "features");
        if (!fs.existsSync(featuresDir)) {
          fs.mkdirSync(featuresDir, { recursive: true });
        }
        fs.writeFileSync(envPath, template, "utf-8");
        const doc = await vscode.workspace.openTextDocument(envPath);
        await vscode.window.showTextDocument(doc);
        void vscode.window.showInformationMessage("Created features/environment.py with Behave hooks!");
      }
    }
  };

  const discover = async () => {
    await Promise.all([
      behaveTestController.discoverAll(),
      stepDefinitionIndex.rebuild(),
      featureStepIndex.rebuild(),
    ]);
  };

  const analyze = async (uri?: vscode.Uri) => {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (targetUri && targetUri.fsPath.endsWith(".feature")) {
      await behaveTestController.loadFile(targetUri.fsPath);
    }
  };

  const reset = async () => {
    await discover();
  };

  const debugScenario = async (args: RunScenarioArgs) => {
    if (!args?.filePath) {
      vscode.window.showErrorMessage("Behave: missing scenario information.");
      return;
    }

    const scenarioName = args.scenarioName ?? "";
    if (!args.runAll && !scenarioName) {
      vscode.window.showErrorMessage("Behave: missing scenario name for debug.");
      return;
    }

    await revealLiveRunPanel();

    const capsFile = await promptOrResolveCapsFile(args.filePath);
    if (capsFile === null) {
      return;
    }

    const justMyCode = getJustMyCodeForResource(args.filePath);
    const { workspaceFolder, config } = buildPythonBehaveDebugLaunchFromCliArgs({
      filePath: args.filePath,
      scenarioName,
      runAll: args.runAll,
      workspaceRoot: args.workspaceRoot,
      justMyCode,
      capsFile: capsFile ?? undefined,
    });

    const started = await vscode.debug.startDebugging(
      workspaceFolder ?? undefined,
      config
    );
    if (!started) {
      vscode.window.showErrorMessage("Behave: failed to start debugger.");
    }
  };

    const openConfiguration = () => {
      const { SmartBehaveConfigPanel } = require("./ui/configWebview");
      SmartBehaveConfigPanel.createOrShow(context.extensionUri);
    };

    const generateStep = async (uri: vscode.Uri, snippet: GeneratedStepSnippet) => {
      await executeGenerateStepDefinition(uri, snippet);
    };

    const copySnippet = async (code: string) => {
      await vscode.env.clipboard.writeText(code);
      vscode.window.showInformationMessage("Smart Behave: Step definition snippet copied to clipboard!");
    };

    // Register commands under smartBehave, behave, and behaveRunner namespaces
    const commands = [
      { name: "smartBehave.generateStepDefinition", fn: generateStep },
      { name: "smartBehave.copyStepSnippet", fn: copySnippet },
      { name: "smartBehave.openConfiguration", fn: openConfiguration },
      { name: "smartBehave.openSettings", fn: openConfiguration },
      { name: "behave.openConfiguration", fn: openConfiguration },
      { name: "behave.run", fn: runActive },
      { name: "smartBehave.run", fn: runActive },
      { name: "behave.debug", fn: debugActive },
      { name: "smartBehave.debug", fn: debugActive },
      { name: "behave.test", fn: runActive },
      { name: "smartBehave.test", fn: runActive },
      { name: "behave.discover", fn: discover },
      { name: "smartBehave.discover", fn: discover },
      { name: "behave.analyze", fn: analyze },
      { name: "smartBehave.analyze", fn: analyze },
      { name: "behave.reset", fn: reset },
      { name: "smartBehave.reset", fn: reset },
      { name: "behave.cancelRun", fn: cancelRun },
      { name: "smartBehave.cancelRun", fn: cancelRun },
      { name: "behaveRunner.cancelRun", fn: cancelRun },
      { name: "behave.rerunLastRun", fn: rerunLast },
      { name: "smartBehave.rerunLastRun", fn: rerunLast },
      { name: "behaveRunner.rerunLastRun", fn: rerunLast },
      { name: "behave.debugScenario", fn: debugScenario },
      { name: "smartBehave.debugScenario", fn: debugScenario },
      { name: "behaveRunner.debugScenario", fn: debugScenario },
      { name: "smartBehave.showLiveRun", fn: revealLiveRunPanel },
      { name: "behave.showLiveRun", fn: revealLiveRunPanel },
      { name: "behaveRunner.showLiveRun", fn: revealLiveRunPanel },
      { name: "smartBehave.runWithTags", fn: runWithTags },
      { name: "behave.runWithTags", fn: runWithTags },
      { name: "smartBehave.runDryRun", fn: runDryRun },
      { name: "behave.runDryRun", fn: runDryRun },
      { name: "smartBehave.runWip", fn: runWip },
      { name: "behave.runWip", fn: runWip },
      { name: "smartBehave.openEnvironmentFile", fn: openEnvironmentFile },
      { name: "behave.openEnvironmentFile", fn: openEnvironmentFile },
      {
        name: "smartBehave.generateAllureReport",
        fn: async () => {
          const res = await behaveResultsManager.generateAllureReport();
          if (res.success) {
            const ans = await vscode.window.showInformationMessage(res.message, "View Report");
            if (ans === "View Report") {
              await behaveResultsManager.viewAllureReport();
            }
          } else {
            void vscode.window
              .showErrorMessage(res.message, "Install Instructions", "View HTML Preview")
              .then(async (ans) => {
                if (ans === "Install Instructions") {
                  await vscode.env.openExternal(
                    vscode.Uri.parse("https://allurereport.org/docs/install/")
                  );
                } else if (ans === "View HTML Preview") {
                  await behaveResultsManager.viewAllureReport();
                }
              });
          }
        }
      },
      {
        name: "smartBehave.viewAllureReport",
        fn: async () => {
          await behaveResultsManager.viewAllureReport();
        }
      },
      {
        name: "smartBehave.clearResults",
        fn: () => {
          behaveResultsManager.clearRecords();
          void vscode.window.showInformationMessage("Cucumber-Behave: Test results history cleared.");
        }
      },
      {
        name: "smartBehave.refreshDiscovery",
        fn: async () => {
          await behaveTestController.discoverAll();
          void vscode.window.showInformationMessage("Cucumber-Behave: Feature discovery refreshed.");
        }
      },
      {
        name: "smartBehave.openMainScreen",
        fn: () => {
          openMainScreenPanel();
        }
      },
      {
        name: "behave.openMainScreen",
        fn: () => {
          openMainScreenPanel();
        }
      },
      {
        name: "smartBehave.formatCustomGherkin",
        fn: async () => {
          const editor = vscode.window.activeTextEditor;
          if (!editor || !editor.document.fileName.endsWith(".feature")) {
            void vscode.window.showInformationMessage("Please open a .feature file to format.");
            return;
          }
          await vscode.commands.executeCommand("editor.action.formatDocument");
          void vscode.window.showInformationMessage("Smart Cucumber-Behave: Feature formatted with custom indentation.");
        },
      },
    ];

    for (const cmd of commands) {
      try {
        context.subscriptions.push(vscode.commands.registerCommand(cmd.name, cmd.fn));
      } catch (err) {
        LOG.warn(`Command '${cmd.name}' already registered or could not register:`, err);
      }
    }
  }
