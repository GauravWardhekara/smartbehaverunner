import * as vscode from "vscode";
import { registerBehaveCodeLens } from "./codeLens";
import { registerCommands } from "./commands";
import { LOG } from "./log";
import { settings } from "./settings";
import { behaveTestController } from "./testController";
import { stepDefinitionIndex } from "./language/stepIndex";
import { featureStepIndex } from "./language/featureStepIndex";
import { BehaveCompletionItemProvider } from "./language/stepCompletionProvider";
import { BehaveTagCompletionProvider } from "./language/tagCompletionProvider";
import { BehaveCodeActionProvider } from "./language/stepCodeActionProvider";
import { BehaveDefinitionProvider } from "./language/stepDefinitionProvider";
import { BehaveStepReferenceProvider } from "./language/stepReferenceProvider";
import { BehaveStepUsageProvider } from "./language/stepUsageProvider";
import { BehaveFormattingProvider } from "./language/featureFormattingProvider";
import {
  BEHAVE_SEMANTIC_TOKEN_LEGEND,
  BehaveSemanticTokensProvider
} from "./language/featureSemanticTokensProvider";
import { BehaveDocumentSymbolProvider } from "./language/featureDocumentSymbolProvider";
import { BehaveHoverProvider } from "./language/stepHoverProvider";
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
import { behaveResultsManager } from "./run/behaveResultsManager";
import { getExtension } from "./utils/python";
import { ensureLaunchJsonWithSmartBehaveArgs } from "./run/behaveLaunchConfig";
import {
  activateCucumberLanguageServer,
  deactivateCucumberLanguageServer,
} from "./cucumberLanguageServer";

let isActivated = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (isActivated) {
    LOG.info("Smart Cucumber-Behave extension already activated; skipping duplicate activation.");
    return;
  }
  isActivated = true;
  LOG.info("Smart Cucumber-Behave extension activating...");

  try {
    // 0. Start Official Cucumber Language Server
    await activateCucumberLanguageServer(context);

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
    behaveResultsManager.initialize(context);
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
      { language: "cucumber", scheme: "file" },
      { language: "behave", scheme: "file" },
      { language: "feature", scheme: "file" },
      { language: "gherkin", scheme: "file" },
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
      // Tag autocomplete (@wip, @smoke, etc.)
      vscode.languages.registerCompletionItemProvider(
        featureSelector,
        new BehaveTagCompletionProvider(),
        "@"
      ),
      // Code actions (QuickFix to generate Python step definition)
      vscode.languages.registerCodeActionsProvider(
        featureSelector,
        new BehaveCodeActionProvider(),
        {
          providedCodeActionKinds: BehaveCodeActionProvider.providedCodeActionKinds
        }
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
      // On-Type Formatting for Gherkin Tables (|)
      vscode.languages.registerOnTypeFormattingEditProvider(
        featureSelector,
        new BehaveFormattingProvider(),
        "|"
      ),
      // Semantic Tokens (Syntax coloring for tags, steps, placeholders, tables, docstrings)
      vscode.languages.registerDocumentSemanticTokensProvider(
        featureSelector,
        new BehaveSemanticTokensProvider(),
        BEHAVE_SEMANTIC_TOKEN_LEGEND
      ),
      // Document Symbols (Outline and Breadcrumbs navigation for .feature files)
      vscode.languages.registerDocumentSymbolProvider(
        featureSelector,
        new BehaveDocumentSymbolProvider()
      ),
      // Hover Information (Step definitions, signatures, and locations)
      vscode.languages.registerHoverProvider(
        featureSelector,
        new BehaveHoverProvider()
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

    // 8. Provision launch.json with smartBehaveArgs if missing
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of workspaceFolders) {
      void ensureLaunchJsonWithSmartBehaveArgs(folder.uri.fsPath);
    }

    // 9. Watch document changes for test controller & diagnostics
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
      vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        for (const added of e.added) {
          void ensureLaunchJsonWithSmartBehaveArgs(added.uri.fsPath);
        }
        if (settings.autoDiscover()) {
          void behaveTestController.discoverAll();
        }
      })
    );

    LOG.info("Smart Cucumber-Behave extension successfully activated.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    LOG.error("Failed to activate Smart Cucumber-Behave extension:", msg);
    void vscode.window.showErrorMessage(`Smart Cucumber-Behave extension failed to activate: ${msg}`);
  }
}

export async function deactivate(): Promise<void> {
  isActivated = false;
  setBehaveRunnerContext(undefined);
  await deactivateCucumberLanguageServer();
}
