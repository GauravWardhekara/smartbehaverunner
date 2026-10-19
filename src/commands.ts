import * as vscode from "vscode";
import { LOG } from "./log";
import {
  cancelActiveBehaveRun,
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
import { getBehaveHierarchyStoreRef } from "./run/behaveRunnerContext";
import {
  buildPythonBehaveDebugLaunchFromCliArgs,
  getJustMyCodeForResource
} from "./run/behavePythonDebug";
import { behaveTestController } from "./testController";
import { stepDefinitionIndex } from "./language/stepIndex";
import { featureStepIndex } from "./language/featureStepIndex";
import { revealLiveRunPanel } from "./ui/liveRunWebview";

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

  const cancelRun = () => {
    logBehaveRunCancel("command behave.cancelRun");
    cancelActiveBehaveRun();
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

    const justMyCode = getJustMyCodeForResource(args.filePath);
    const { workspaceFolder, config } = buildPythonBehaveDebugLaunchFromCliArgs({
      filePath: args.filePath,
      scenarioName,
      runAll: args.runAll,
      workspaceRoot: args.workspaceRoot,
      justMyCode,
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

    // Register commands under smartBehave, behave, and behaveRunner namespaces
    const commands = [
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
