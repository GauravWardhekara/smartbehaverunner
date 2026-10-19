import * as vscode from "vscode";
import { registerBehaveCodeLens } from "./codeLens";
import { registerCommands } from "./commands";
import { LOG } from "./log";
import { settings } from "./settings";
import { behaveTestController } from "./testController";
import { stepDefinitionIndex } from "./language/stepIndex";
import { featureStepIndex } from "./language/featureStepIndex";
import { BehaveCompletionItemProvider } from "./language/stepCompletionProvider";
import { BehaveDefinitionProvider } from "./language/stepDefinitionProvider";
import { BehaveStepReferenceProvider } from "./language/stepReferenceProvider";
import { BehaveStepUsageProvider } from "./language/stepUsageProvider";
import { BehaveFormattingProvider } from "./language/featureFormattingProvider";
import {
  BEHAVE_SEMANTIC_TOKEN_LEGEND,
  BehaveSemanticTokensProvider
} from "./language/featureSemanticTokensProvider";
import { behaveDiagnosticsManager } from "./language/featureDiagnostics";
import {
  registerBehaveHierarchyStore,
  type BehaveHierarchyStore
} from "./run/behaveHierarchyModel";
import {
  createBehaveRunSinks,
  setBehaveRunnerContext
} from "./run/behaveRunnerContext";
import { registerBehaveOutputChannel } from "./run/behaveRunOutput";
import { registerBehaveRunWorkspacePersistence } from "./run/behaveRunLastRun";
import { registerLiveRunWebview } from "./ui/liveRunWebview";
import { getExtension } from "./utils/python";

let isActivated = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (isActivated) {
    LOG.info("Smart Behave extension already activated; skipping duplicate activation.");
    return;
  }
  isActivated = true;
  LOG.info("Smart Behave extension activating...");

  try {
    // 1. Register Execution Store & Sinks
    const store = registerBehaveHierarchyStore(context);
    const runSinks = createBehaveRunSinks();
    setBehaveRunnerContext({
      extensionUri: context.extensionUri,
      extensionPath: context.extensionPath ?? "",
      hierarchyStore: store,
      runSinks,
    });
    context.subscriptions.push({
      dispose: () => setBehaveRunnerContext(undefined),
    });

    registerBehaveRunWorkspacePersistence(context);
    registerBehaveOutputChannel(context);
    registerLiveRunWebview(context);

    // 2. Register Test Controller
    behaveTestController.register(context, store);

    // 3. Register CodeLens
    registerBehaveCodeLens(context, store);

    // 4. Register Commands
    registerCommands(context);

    // 5. Register Language Features
    stepDefinitionIndex.registerWatcher(context);
    featureStepIndex.registerWatcher(context);

    const featureSelector: vscode.DocumentSelector = [
      { language: "behave", scheme: "file" },
      { language: "feature", scheme: "file" },
      { pattern: "**/*.feature" },
    ];
    const pythonSelector: vscode.DocumentSelector = [
      { language: "python", scheme: "file" },
    ];

    context.subscriptions.push(
      // Step autocomplete with snippets
      vscode.languages.registerCompletionItemProvider(
        featureSelector,
        new BehaveCompletionItemProvider(),
        " "
      ),
      // Go to Definition (.feature -> Python step function)
      vscode.languages.registerDefinitionProvider(
        featureSelector,
        new BehaveDefinitionProvider()
      ),
      // Find References (Python step function -> .feature steps)
      vscode.languages.registerReferenceProvider(
        pythonSelector,
        new BehaveStepReferenceProvider()
      ),
      // Go to Definition (Python step function -> .feature usages)
      vscode.languages.registerDefinitionProvider(
        pythonSelector,
        new BehaveStepUsageProvider()
      ),
      // Document Formatting (Gherkin tables & indentation)
      vscode.languages.registerDocumentFormattingEditProvider(
        featureSelector,
        new BehaveFormattingProvider()
      ),
      vscode.languages.registerDocumentRangeFormattingEditProvider(
        featureSelector,
        new BehaveFormattingProvider()
      ),
      // Semantic Tokens (Syntax coloring for tags, steps, placeholders, tables, docstrings)
      vscode.languages.registerDocumentSemanticTokensProvider(
        featureSelector,
        new BehaveSemanticTokensProvider(),
        BEHAVE_SEMANTIC_TOKEN_LEGEND
      )
    );

    // Diagnostics for undefined steps
    behaveDiagnosticsManager.register(context);

    // 6. Python Extension Integration & Startup Discovery
    const pythonExt = getExtension();
    if (pythonExt.isOk()) {
      context.subscriptions.push(
        pythonExt.value.exports.environments.onDidChangeActiveEnvironmentPath(() => {
          if (settings.autoDiscover()) {
            void behaveTestController.discoverAll();
          }
        })
      );
    }

    if (settings.autoDiscover()) {
      void behaveTestController.discoverAll();
    }

    // 7. Watch document changes for test controller & diagnostics
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor?.document.fileName.endsWith(".feature")) {
          void behaveTestController.loadFile(editor.document.fileName);
        }
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.fileName.endsWith(".feature")) {
          void behaveTestController.loadFile(doc.fileName);
        }
      }),
      vscode.workspace.onDidDeleteFiles((e) => {
        for (const file of e.files) {
          if (file.fsPath.endsWith(".feature")) {
            behaveTestController.unloadFile(file.fsPath);
          }
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (settings.autoDiscover()) {
          void behaveTestController.discoverAll();
        }
      })
    );

    LOG.info("Behave extension successfully activated.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    LOG.error("Failed to activate Behave extension:", msg);
    void vscode.window.showErrorMessage(`Behave extension failed to activate: ${msg}`);
  }
}

export function deactivate(): void {
  isActivated = false;
  setBehaveRunnerContext(undefined);
}
