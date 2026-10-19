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
import { revealLiveRunPanel } from "./ui/liveRunWebview";
import { executeGenerateStepDefinition, GeneratedStepSnippet } from "./language/stepCodeActionProvider";

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
    ];

    for (const cmd of commands) {
      try {
        context.subscriptions.push(vscode.commands.registerCommand(cmd.name, cmd.fn));
      } catch (err) {
        LOG.warn(`Command '${cmd.name}' already registered or could not register:`, err);
      }
    }
  }
