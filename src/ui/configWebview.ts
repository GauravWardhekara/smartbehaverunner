import * as vscode from "vscode";
import { getPythonInterpreterPath } from "../utils/python";
import { behavesSupportsExplicitNoCaptureStdoutFlag } from "../run/behaveVersion";
import { settings } from "../settings";
import { stepDefinitionIndex } from "../language/stepIndex";
import { featureStepIndex } from "../language/featureStepIndex";
import { behaveTestController } from "../testController";
import {
  probeAllLanguageRuntimes,
  LanguageRuntimeInfo,
} from "../utils/languageRuntimes";
import { detectBehaveProjectConfig } from "../run/behaveConfigFile";
import * as path from "path";
import * as fs from "fs";

export class SmartBehaveConfigPanel {
  public static currentPanel: SmartBehaveConfigPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): SmartBehaveConfigPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SmartBehaveConfigPanel.currentPanel) {
      SmartBehaveConfigPanel.currentPanel.panel.reveal(column);
      return SmartBehaveConfigPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "smartCucumberBehaveConfig",
      "Smart Cucumber-Behave: Configuration & Diagnostics",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    const logoPngPath = path.join(extensionUri.fsPath, "data", "logo.png");
    panel.iconPath = fs.existsSync(logoPngPath)
      ? vscode.Uri.joinPath(extensionUri, "data", "logo.png")
      : vscode.Uri.joinPath(extensionUri, "media", "gherkin.svg");

    SmartBehaveConfigPanel.currentPanel = new SmartBehaveConfigPanel(panel, extensionUri);
    return SmartBehaveConfigPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri) {
    this.panel = panel;
    const logoPngPath = path.join(this.extensionUri.fsPath, "data", "logo.png");
    this.panel.iconPath = fs.existsSync(logoPngPath)
      ? vscode.Uri.joinPath(this.extensionUri, "data", "logo.png")
      : vscode.Uri.joinPath(this.extensionUri, "media", "gherkin.svg");
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "ready":
            this.sendCurrentState();
            void this.handleProbeAllRuntimes();
            return;
          case "probeAllRuntimes":
            await this.handleProbeAllRuntimes();
            return;
          case "probePython":
            await this.handleProbePython();
            return;
          case "saveSettings":
            await this.handleSaveSettings(message.settings, message.target);
            return;
          case "rebuildIndex":
            await this.handleRebuildIndex();
            return;
          case "openEnvironmentFile":
            await vscode.commands.executeCommand("smartBehave.openEnvironmentFile");
            return;
          case "openVsCodeSettings":
            await vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "Smart Cucumber-Behave"
            );
            return;
        }
      },
      null,
      this.disposables
    );
  }

  private sendCurrentState(): void {
    const activeDoc = vscode.window.activeTextEditor?.document.uri.fsPath || "";
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    const py = getPythonInterpreterPath(activeDoc, wsFolder);
    const projectCfg = detectBehaveProjectConfig(wsFolder);

    const data = {
      pythonPath: py.path || "Not detected",
      pythonSource: py.source,
      behaveConfigFile: projectCfg ? path.basename(projectCfg.filePath) : "None detected",
      behaveConfigTags: projectCfg?.config.defaultTags || projectCfg?.config.tags || "None",
      behaveConfigUserdata: projectCfg && Object.keys(projectCfg.config.userdata).length > 0
        ? Object.entries(projectCfg.config.userdata).map(([k, v]) => `${k}=${v}`).join(", ")
        : "None",
      allowedFiles: settings.allowedFiles(),
      stepPatterns: settings.stepDefinitionsPatterns(),
      featurePatterns: settings.featureFilesPatterns(),
      autoDiscover: settings.autoDiscover(),
      codeLens: settings.codeLens(),
      arguments: settings.arguments().join(" "),
      extraArgs: settings.extraArgs().join(" "),
      configDirectory: settings.configDirectory(),
      defaultConfigFile: settings.defaultConfigFile(),
      diffRegex: settings.diffRegex()[0] || "",
      justMyCode: settings.justMyCode(),
      livePanelEnabled: settings.livePanelEnabled(),
      indexedSteps: stepDefinitionIndex.getDefinitions().length,
      indexedFeatures: featureStepIndex.getSteps().length,

      // Custom Gherkin Formatter Settings
      formatCustomIndentEnabled: settings.formatting.customIndentEnabled(),
      formatIndentCharacter: settings.formatting.indentCharacter(),
      formatIndentFeature: settings.formatting.indentFeature(),
      formatIndentScenario: settings.formatting.indentScenario(),
      formatIndentBackground: settings.formatting.indentBackground(),
      formatIndentRule: settings.formatting.indentRule(),
      formatIndentExamples: settings.formatting.indentExamples(),
      formatIndentGiven: settings.formatting.indentGiven(),
      formatIndentWhen: settings.formatting.indentWhen(),
      formatIndentThen: settings.formatting.indentThen(),
      formatIndentAnd: settings.formatting.indentAnd(),
      formatIndentBut: settings.formatting.indentBut(),
      formatRelativeAnd: settings.formatting.relativeAnd(),

      // Cucumber Settings
      cucumberFeatures: settings.cucumber.features().join("\n"),
      cucumberGlue: settings.cucumber.glue().join("\n"),
      cucumberParameterTypes: JSON.stringify(settings.cucumber.parameterTypes(), null, 2),
    };

    void this.panel.webview.postMessage({ command: "state", data });
  }

  private async handleProbeAllRuntimes(): Promise<void> {
    const activeDoc = vscode.window.activeTextEditor?.document.uri.fsPath || "";
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    const runtimes: LanguageRuntimeInfo[] = await probeAllLanguageRuntimes(activeDoc, wsFolder);
    void this.panel.webview.postMessage({ command: "runtimesResult", runtimes });
  }

  private async handleProbePython(): Promise<void> {
    const activeDoc = vscode.window.activeTextEditor?.document.uri.fsPath || "";
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    const py = getPythonInterpreterPath(activeDoc, wsFolder);

    if (!py.path) {
      void this.panel.webview.postMessage({
        command: "probeResult",
        success: false,
        message: "No Python interpreter could be resolved. Please select an environment in VS Code.",
      });
      return;
    }

    try {
      const explicitFlag = behavesSupportsExplicitNoCaptureStdoutFlag(py.path);
      void this.panel.webview.postMessage({
        command: "probeResult",
        success: true,
        message: `Behave is available via ${py.path} (Explicit stdout flag supported: ${explicitFlag ? "Yes" : "No"})`,
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      void this.panel.webview.postMessage({
        command: "probeResult",
        success: false,
        message: `Behave probe failed: ${err}`,
      });
    }
  }

  private async handleSaveSettings(
    newSettings: Record<string, any>,
    targetScope: "workspace" | "global"
  ): Promise<void> {
    const target =
      targetScope === "workspace"
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    const smartConfig = vscode.workspace.getConfiguration("smartBehave");
    const behaveConfig = vscode.workspace.getConfiguration("behave");
    const cucumberConfig = vscode.workspace.getConfiguration("cucumber");

    const updateBoth = async (key: string, val: any) => {
      await smartConfig.update(key, val, target);
      await behaveConfig.update(key, val, target);
    };

    // 1. Runner & Behave settings
    if (newSettings.allowedFiles !== undefined) {
      await updateBoth("allowedFiles", newSettings.allowedFiles);
    }
    if (newSettings.configDirectory !== undefined) {
      await updateBoth("configDirectory", String(newSettings.configDirectory).trim());
    }
    if (newSettings.defaultConfigFile !== undefined) {
      await updateBoth("defaultConfigFile", String(newSettings.defaultConfigFile).trim());
    }
    if (newSettings.autoDiscover !== undefined) {
      await updateBoth("autoDiscover", Boolean(newSettings.autoDiscover));
    }
    if (newSettings.codeLens !== undefined) {
      await updateBoth("codeLens", Boolean(newSettings.codeLens));
    }
    if (newSettings.justMyCode !== undefined) {
      await updateBoth("debug.justMyCode", Boolean(newSettings.justMyCode));
    }
    if (newSettings.arguments !== undefined) {
      const args = String(newSettings.arguments)
        .split(" ")
        .map((s) => s.trim())
        .filter(Boolean);
      await updateBoth("arguments", args);
    }
    if (newSettings.extraArgs !== undefined) {
      const extra = String(newSettings.extraArgs)
        .split(" ")
        .map((s) => s.trim())
        .filter(Boolean);
      await updateBoth("extraArgs", extra);
    }

    // 2. Custom Gherkin Formatter settings
    if (newSettings.formatCustomIndentEnabled !== undefined) {
      await smartConfig.update(
        "formatting.customIndent.enabled",
        Boolean(newSettings.formatCustomIndentEnabled),
        target
      );
    }
    if (newSettings.formatIndentCharacter !== undefined) {
      await smartConfig.update(
        "formatting.indentCharacter",
        String(newSettings.formatIndentCharacter),
        target
      );
    }
    if (newSettings.formatIndentFeature !== undefined) {
      await smartConfig.update(
        "formatting.indent.feature",
        Number(newSettings.formatIndentFeature),
        target
      );
    }
    if (newSettings.formatIndentScenario !== undefined) {
      await smartConfig.update(
        "formatting.indent.scenario",
        Number(newSettings.formatIndentScenario),
        target
      );
    }
    if (newSettings.formatIndentBackground !== undefined) {
      await smartConfig.update(
        "formatting.indent.background",
        Number(newSettings.formatIndentBackground),
        target
      );
    }
    if (newSettings.formatIndentRule !== undefined) {
      await smartConfig.update(
        "formatting.indent.rule",
        Number(newSettings.formatIndentRule),
        target
      );
    }
    if (newSettings.formatIndentExamples !== undefined) {
      await smartConfig.update(
        "formatting.indent.examples",
        Number(newSettings.formatIndentExamples),
        target
      );
    }
    if (newSettings.formatIndentGiven !== undefined) {
      await smartConfig.update(
        "formatting.indent.given",
        Number(newSettings.formatIndentGiven),
        target
      );
    }
    if (newSettings.formatIndentWhen !== undefined) {
      await smartConfig.update(
        "formatting.indent.when",
        Number(newSettings.formatIndentWhen),
        target
      );
    }
    if (newSettings.formatIndentThen !== undefined) {
      await smartConfig.update(
        "formatting.indent.then",
        Number(newSettings.formatIndentThen),
        target
      );
    }
    if (newSettings.formatIndentAnd !== undefined) {
      await smartConfig.update(
        "formatting.indent.and",
        Number(newSettings.formatIndentAnd),
        target
      );
    }
    if (newSettings.formatIndentBut !== undefined) {
      await smartConfig.update(
        "formatting.indent.but",
        Number(newSettings.formatIndentBut),
        target
      );
    }
    if (newSettings.formatRelativeAnd !== undefined) {
      await smartConfig.update(
        "formatting.relativeAnd",
        Boolean(newSettings.formatRelativeAnd),
        target
      );
    }

    // 3. Cucumber Language Server settings
    if (newSettings.cucumberFeatures !== undefined) {
      const featGlobs = String(newSettings.cucumberFeatures)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      await cucumberConfig.update("features", featGlobs, target);
    }
    if (newSettings.cucumberGlue !== undefined) {
      const glueGlobs = String(newSettings.cucumberGlue)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      await cucumberConfig.update("glue", glueGlobs, target);
    }
    if (newSettings.cucumberParameterTypes !== undefined) {
      try {
        const parsed = JSON.parse(newSettings.cucumberParameterTypes);
        if (Array.isArray(parsed)) {
          await cucumberConfig.update("parameterTypes", parsed, target);
        }
      } catch {
        // ignore invalid JSON
      }
    }

    void vscode.window.showInformationMessage(
      `Smart Cucumber-Behave: Settings saved successfully to ${
        targetScope === "workspace" ? "Workspace" : "User"
      } settings.`
    );
    this.sendCurrentState();
  }

  private async handleRebuildIndex(): Promise<void> {
    await Promise.all([
      stepDefinitionIndex.rebuild(),
      featureStepIndex.rebuild(),
      behaveTestController.discoverAll(),
    ]);
    void vscode.window.showInformationMessage(
      `Smart Cucumber-Behave: Rebuilt indices (${stepDefinitionIndex.getDefinitions().length} Python step definitions, ${featureStepIndex.getSteps().length} feature steps found).`
    );
    this.sendCurrentState();
  }

  public dispose(): void {
    SmartBehaveConfigPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Smart Cucumber-Behave Configuration</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-foreground, #cccccc);
      --card-bg: var(--vscode-editorWidget-background, rgba(255, 255, 255, 0.04));
      --border: var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
      --primary: var(--vscode-button-background, #0e639c);
      --primary-hover: var(--vscode-button-hoverBackground, #1177bb);
      --badge-bg: var(--vscode-badge-background, #007acc);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --code-bg: var(--vscode-textCodeBlock-background, #141414);
    }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      color: var(--fg);
      background-color: var(--bg);
      padding: 24px;
      line-height: 1.5;
      max-width: 980px;
      margin: 0 auto;
    }
    h1, h2, h3 {
      font-weight: 600;
      color: var(--vscode-titleBar-activeForeground, var(--fg));
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
      margin-top: 24px;
    }
    .header-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      background: var(--badge-bg);
      color: var(--badge-fg);
      padding: 3px 10px;
      border-radius: 12px;
      vertical-align: middle;
      margin-left: 8px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 22px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
    }
    .tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      overflow-x: auto;
    }
    .tab-btn {
      background: transparent;
      color: var(--fg);
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 7px 14px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tab-btn.active {
      background: var(--primary);
      color: #fff;
      border-color: var(--primary);
    }
    .tab-btn:hover:not(.active) {
      background: rgba(255, 255, 255, 0.08);
    }
    .row {
      display: flex;
      flex-direction: column;
      margin-bottom: 14px;
    }
    .row label {
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 13px;
    }
    .row .desc {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 6px;
    }
    input[type="text"], input[type="number"], select, textarea {
      background: var(--vscode-input-background, #222);
      color: var(--vscode-input-foreground, #eee);
      border: 1px solid var(--vscode-input-border, #444);
      padding: 7px 10px;
      border-radius: 4px;
      font-size: 13px;
      box-sizing: border-box;
      width: 100%;
    }
    input[type="number"] {
      width: 80px;
    }
    .indent-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-top: 12px;
    }
    .indent-item {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .indent-item .item-title {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .indent-item .item-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      margin-bottom: 8px;
    }
    .preset-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
      align-items: center;
    }
    .preset-btn {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #fff);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 5px 12px;
      font-size: 12px;
      cursor: pointer;
    }
    .preset-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    .preview-box {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 14px;
      font-family: var(--vscode-editor-font-family, Consolas, Monaco, monospace);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre;
      overflow-x: auto;
      color: #9cdcfe;
      margin-top: 10px;
    }
    .runtimes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 14px;
    }
    .runtime-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      position: relative;
    }
    .runtime-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 13px;
    }
    .runtime-badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 10px;
      font-weight: 600;
      margin-left: auto;
    }
    .badge-ready {
      background: rgba(46, 160, 67, 0.2);
      color: #3fb950;
      border: 1px solid rgba(46, 160, 67, 0.4);
    }
    .badge-missing {
      background: rgba(248, 81, 73, 0.2);
      color: #f85149;
      border: 1px solid rgba(248, 81, 73, 0.4);
    }
    .runtime-details {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888);
      margin-top: 4px;
    }
    button {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      margin-right: 8px;
      margin-top: 6px;
    }
    button:hover {
      background: var(--primary-hover);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #fff);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .stat-pill {
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 12px;
      border-radius: 6px;
      text-align: center;
    }
    .stat-pill .num {
      font-size: 24px;
      font-weight: 700;
      color: var(--vscode-textLink-foreground, #3794ff);
    }
    .stat-pill .label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #aaa);
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      cursor: pointer;
    }
    .footer {
      margin-top: 36px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
      text-align: center;
    }
    .status-box {
      padding: 10px 14px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      margin-top: 10px;
      display: none;
    }
    .status-success {
      display: block;
      background: rgba(46, 160, 67, 0.15);
      border: 1px solid rgba(46, 160, 67, 0.4);
      color: #3fb950;
    }
    .status-error {
      display: block;
      background: rgba(248, 81, 73, 0.15);
      border: 1px solid rgba(248, 81, 73, 0.4);
      color: #f85149;
    }
  </style>
</head>
<body>
  <h1>Smart Cucumber-Behave <span class="header-badge">v1.0.0</span></h1>
  <p>Multi-language BDD environment management, custom Gherkin formatting, and runner configuration across Python, TypeScript/JavaScript, Java, C#, Ruby, PHP, Rust, and Go.</p>

  <div class="tabs">
    <button class="tab-btn active" data-tab="tab-overview">🌐 All Languages Overview</button>
    <button class="tab-btn" data-tab="tab-formatter">📐 Custom Gherkin Formatter</button>
    <button class="tab-btn" data-tab="tab-cucumber">🥒 Cucumber Language Server</button>
    <button class="tab-btn" data-tab="tab-behave">🐍 Python / Behave Runner</button>
  </div>

  <!-- TAB 1: OVERVIEW & MULTI-LANGUAGE RUNTIMES -->
  <div id="tab-overview" class="tab-pane">
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="border:none; margin:0; padding:0;">🌐 Supported Language Runtimes</h2>
        <button id="btnProbeAll" class="secondary">Probe All Runtimes</button>
      </div>
      <p style="font-size: 12px; color: var(--vscode-descriptionForeground, #888); margin-top: 6px;">
        Smart Cucumber-Behave indexes step definitions and supports BDD workflows across 8 programming languages.
      </p>
      <div id="runtimesGrid" class="runtimes-grid">
        <div style="grid-column: 1 / -1; font-size: 13px; color: #888;">Probing system runtimes...</div>
      </div>
    </div>

    <div class="card">
      <h2>📊 Indexing & Workspace Diagnostics</h2>
      <div class="stats-grid">
        <div class="stat-pill">
          <div class="num" id="statSteps">0</div>
          <div class="label">Indexed Python Step Definitions</div>
        </div>
        <div class="stat-pill">
          <div class="num" id="statFeatures">0</div>
          <div class="label">Feature Steps in Workspace</div>
        </div>
        <div class="stat-pill">
          <div class="num" id="statLanguages">8</div>
          <div class="label">Supported Glue Languages</div>
        </div>
      </div>
      <div style="margin-top: 14px;">
        <button id="btnRebuild" class="secondary">Rebuild Step & Feature Index</button>
      </div>
    </div>
  </div>

  <!-- TAB 2: CUSTOM GHERKIN FORMATTER -->
  <div id="tab-formatter" class="tab-pane" style="display:none;">
    <div class="card">
      <h2>📐 Custom Gherkin Indentation Formatter</h2>
      <p style="font-size: 12px; color: var(--vscode-descriptionForeground, #888);">
        Configure exact tab levels for <strong>Feature, Scenario, Background, Given, When, Then, And, But</strong>. Changes apply automatically to document formatting (<code>Shift+Alt+F</code>) and format-on-save.
      </p>

      <div class="preset-bar">
        <span style="font-weight: 600; font-size: 12px;">Presets:</span>
        <button class="preset-btn" id="btnPresetUser">Ladder / Stepped (User Example: 0, 1, 2, 2, 3, 4, 4)</button>
        <button class="preset-btn" id="btnPresetStandard">Standard BDD (0, 1, 2, 2, 2, 2, 2)</button>
        <button class="preset-btn" id="btnPresetStrict">Strict Cascade (0, 1, 2, 3, 4, 5, 5)</button>
      </div>

      <div class="row">
        <label>Indentation Unit</label>
        <select id="selIndentChar">
          <option value="auto">Auto (Respect VS Code Tab / Space Settings)</option>
          <option value="tab">Tabs (Force Tab '\t')</option>
          <option value="spaces">Spaces (Uses editor tabSize)</option>
        </select>
      </div>

      <div class="indent-grid">
        <div class="indent-item">
          <div class="item-title"><span>Feature:</span><input type="number" id="indFeature" min="0" max="8" /></div>
          <div class="item-desc">Root level header. (e.g. 0 tabs = no tab)</div>
        </div>
        <div class="indent-item">
          <div class="item-title"><span>Scenario:</span><input type="number" id="indScenario" min="0" max="8" /></div>
          <div class="item-desc">Scenario & Outline header. (e.g. 1 tab after Feature)</div>
        </div>
        <div class="indent-item">
          <div class="item-title"><span>Background:</span><input type="number" id="indBackground" min="0" max="8" /></div>
          <div class="item-desc">Feature background setup block. (e.g. 1 tab)</div>
        </div>
        <div class="indent-item">
          <div class="item-title"><span>Given</span><input type="number" id="indGiven" min="0" max="8" /></div>
          <div class="item-desc">Initial context step. (e.g. 2 tabs = +1 after Scenario)</div>
        </div>
        <div class="indent-item">
          <div class="item-title"><span>When</span><input type="number" id="indWhen" min="0" max="8" /></div>
          <div class="item-desc">Action/event step. (e.g. 2 tabs)</div>
        </div>
        <div class="indent-item">
          <div class="item-title"><span>Then</span><input type="number" id="indThen" min="0" max="8" /></div>
          <div class="item-desc">Outcome/assertion step. (e.g. 3 tabs = +1 after Given)</div>
        </div>
        <div class="indent-item">
          <div class="item-title"><span>And</span><input type="number" id="indAnd" min="0" max="8" /></div>
          <div class="item-desc">Subsequent step. (e.g. 4 tabs = +1 after Then)</div>
        </div>
        <div class="indent-item">
          <div class="item-title"><span>But</span><input type="number" id="indBut" min="0" max="8" /></div>
          <div class="item-desc">Negative condition step. (e.g. 4 tabs)</div>
        </div>
        <div class="indent-item">
          <div class="item-title"><span>Examples:</span><input type="number" id="indExamples" min="0" max="8" /></div>
          <div class="item-desc">Scenario Outline Examples header. (e.g. 2 tabs)</div>
        </div>
      </div>

      <div style="margin-top: 14px;">
        <label class="checkbox-row">
          <input type="checkbox" id="chkRelativeAnd" />
          <span>Relative 'And' / 'But' (automatically indent +1 tab relative to the step it follows)</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="chkCustomIndentEnabled" checked />
          <span>Enable Custom Gherkin Formatter</span>
        </label>
      </div>

      <h3 style="margin-top: 18px;">Live Gherkin Preview</h3>
      <div id="livePreview" class="preview-box"></div>
    </div>
  </div>

  <!-- TAB 3: CUCUMBER LANGUAGE SERVER -->
  <div id="tab-cucumber" class="tab-pane" style="display:none;">
    <div class="card">
      <h2>🥒 Cucumber Language Server Settings</h2>
      <p style="font-size: 12px; color: var(--vscode-descriptionForeground, #888);">
        Configures where the embedded Cucumber Language Server discovers feature files and step glue code across all languages.
      </p>

      <div class="row">
        <label>Features Pattern (<code>cucumber.features</code>)</label>
        <span class="desc">One glob pattern per line specifying where .feature files live</span>
        <textarea id="cucumberFeatures" rows="4"></textarea>
      </div>

      <div class="row">
        <label>Glue Code Patterns (<code>cucumber.glue</code>)</label>
        <span class="desc">One glob pattern per line for step definition sources in Python, JS, TS, Java, C#, Ruby, PHP, Rust, Go</span>
        <textarea id="cucumberGlue" rows="6"></textarea>
      </div>

      <div class="row">
        <label>Custom Parameter Types (<code>cucumber.parameterTypes</code>)</label>
        <span class="desc">JSON array of custom Cucumber Expression parameter types (name + regexp)</span>
        <textarea id="cucumberParameterTypes" rows="4"></textarea>
      </div>
    </div>
  </div>

  <!-- TAB 4: PYTHON / BEHAVE RUNNER -->
  <div id="tab-behave" class="tab-pane" style="display:none;">
    <div class="card">
      <h2>🐍 Python Environment & Behave CLI</h2>
      <div class="row">
        <label>Active Python Interpreter</label>
        <input type="text" id="pythonPath" readonly />
        <span class="desc" id="pythonSource">Resolved from environment</span>
      </div>
      <button id="btnProbe">Probe Behave CLI</button>
      <div id="probeStatus" class="status-box"></div>
    </div>

    <div class="card">
      <h2>📁 Behave Project Configuration & Lifecycle</h2>
      <div class="row">
        <label>Detected Configuration File</label>
        <div id="behaveConfigFile" class="status-box" style="margin-top:4px;">None detected</div>
        <span class="desc">Supports behave.ini, .behaverc, setup.cfg, tox.ini</span>
      </div>
      <div class="row">
        <label>Configured Default Tags</label>
        <div id="behaveConfigTags" class="status-box" style="margin-top:4px;">None</div>
      </div>
      <div class="row">
        <label>Configured Userdata (-D key=value)</label>
        <div id="behaveConfigUserdata" class="status-box" style="margin-top:4px;">None</div>
      </div>
      <button id="btnOpenEnv" style="margin-top:12px;">Open / Create features/environment.py</button>
    </div>

    <div class="card">
      <h2>⚙️ Behave Test Runner Settings</h2>
      <div class="row">
        <label>Feature Files Pattern</label>
        <span class="desc">Glob pattern matching feature files to include in discovery and Test Explorer</span>
        <input type="text" id="allowedFiles" />
      </div>

      <div class="row">
        <label>Default CLI Arguments</label>
        <span class="desc">Arguments passed to Behave CLI on every run (space-separated)</span>
        <input type="text" id="cliArgs" />
      </div>

      <div class="row">
        <label>Extra Arguments</label>
        <span class="desc">Extra arguments passed to both run and debug sessions (e.g. --tags=@smoke)</span>
        <input type="text" id="extraArgs" />
      </div>

      <div class="row">
        <label>Configuration Directory</label>
        <span class="desc">Directory path relative to project root where config/capabilities files are stored (default: configs)</span>
        <input type="text" id="configDirectory" />
      </div>

      <div class="row">
        <label>Default Configuration File (caps_file)</label>
        <span class="desc">Default config file relative path (e.g. configs/ios_caps_v5.json)</span>
        <input type="text" id="defaultConfigFile" />
      </div>

      <div class="row">
        <label class="checkbox-row">
          <input type="checkbox" id="chkAutoDiscover" />
          <span>Auto-discover tests on startup</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="chkCodeLens" />
          <span>Enable in-editor CodeLens (Run/Debug buttons above Scenarios)</span>
        </label>
        <label class="checkbox-row">
          <input type="checkbox" id="chkJustMyCode" />
          <span>Debug: Just My Code (only break in user step code, skip library internals)</span>
        </label>
      </div>
    </div>
  </div>

  <!-- PERSISTENT SAVE ACTIONS -->
  <div class="card" style="margin-top: 18px;">
    <button id="btnSaveWorkspace">Save to Workspace Settings</button>
    <button id="btnSaveUser" class="secondary">Save to User Settings</button>
    <button id="btnOpenVsCodeSettings" class="secondary">Open in VS Code Settings UI</button>
  </div>

  <div class="footer">
    Smart Cucumber-Behave • Official Cucumber Language Server + Smart Behave Runner • MIT License
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        const target = document.getElementById(tabId);
        if (target) {
          target.style.display = 'block';
        }
      });
    });

    window.addEventListener('load', () => {
      vscode.postMessage({ command: 'ready' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'state') {
        const d = msg.data;
        document.getElementById('pythonPath').value = d.pythonPath;
        document.getElementById('pythonSource').textContent = 'Source: ' + d.pythonSource;
        document.getElementById('allowedFiles').value = d.allowedFiles;
        document.getElementById('cliArgs').value = d.arguments;
        document.getElementById('extraArgs').value = d.extraArgs;
        document.getElementById('configDirectory').value = d.configDirectory || '';
        document.getElementById('defaultConfigFile').value = d.defaultConfigFile || '';
        document.getElementById('chkAutoDiscover').checked = d.autoDiscover;
        document.getElementById('chkCodeLens').checked = d.codeLens;
        document.getElementById('chkJustMyCode').checked = d.justMyCode;
        document.getElementById('statSteps').textContent = d.indexedSteps;
        document.getElementById('statFeatures').textContent = d.indexedFeatures;
        if (document.getElementById('behaveConfigFile')) {
          document.getElementById('behaveConfigFile').textContent = d.behaveConfigFile || 'None detected';
        }
        if (document.getElementById('behaveConfigTags')) {
          document.getElementById('behaveConfigTags').textContent = d.behaveConfigTags || 'None';
        }
        if (document.getElementById('behaveConfigUserdata')) {
          document.getElementById('behaveConfigUserdata').textContent = d.behaveConfigUserdata || 'None';
        }

        // Custom indent
        document.getElementById('chkCustomIndentEnabled').checked = d.formatCustomIndentEnabled !== false;
        document.getElementById('selIndentChar').value = d.formatIndentCharacter || 'auto';
        document.getElementById('indFeature').value = d.formatIndentFeature ?? 0;
        document.getElementById('indScenario').value = d.formatIndentScenario ?? 1;
        document.getElementById('indBackground').value = d.formatIndentBackground ?? 1;
        document.getElementById('indGiven').value = d.formatIndentGiven ?? 2;
        document.getElementById('indWhen').value = d.formatIndentWhen ?? 2;
        document.getElementById('indThen').value = d.formatIndentThen ?? 3;
        document.getElementById('indAnd').value = d.formatIndentAnd ?? 4;
        document.getElementById('indBut').value = d.formatIndentBut ?? 4;
        document.getElementById('indExamples').value = d.formatIndentExamples ?? 2;
        document.getElementById('chkRelativeAnd').checked = Boolean(d.formatRelativeAnd);

        // Cucumber settings
        document.getElementById('cucumberFeatures').value = d.cucumberFeatures || '';
        document.getElementById('cucumberGlue').value = d.cucumberGlue || '';
        document.getElementById('cucumberParameterTypes').value = d.cucumberParameterTypes || '[]';

        updateLivePreview();
      } else if (msg.command === 'runtimesResult') {
        renderRuntimes(msg.runtimes);
      } else if (msg.command === 'probeResult') {
        const box = document.getElementById('probeStatus');
        box.textContent = msg.message;
        box.className = 'status-box ' + (msg.success ? 'status-success' : 'status-error');
      }
    });

    function renderRuntimes(runtimes) {
      const container = document.getElementById('runtimesGrid');
      if (!container) return;
      container.innerHTML = '';
      let readyCount = 0;

      runtimes.forEach(r => {
        if (r.installed) readyCount++;
        const card = document.createElement('div');
        card.className = 'runtime-card';

        const badgeClass = r.installed ? 'badge-ready' : 'badge-missing';
        const badgeText = r.installed ? r.version : 'Not detected';

        card.innerHTML = \`
          <div class="runtime-header">
            <span>\${r.icon}</span>
            <span>\${r.name}</span>
            <span class="runtime-badge \${badgeClass}">\${badgeText}</span>
          </div>
          <div class="runtime-details">
            <div><strong>Framework:</strong> \${r.framework}</div>
            <div><strong>Files:</strong> \${r.fileExtension}</div>
            <div style="margin-top: 2px;">\${r.details || ''}</div>
          </div>
        \`;
        container.appendChild(card);
      });
    }

    // Live Gherkin Preview calculation
    function updateLivePreview() {
      const unitType = document.getElementById('selIndentChar').value;
      const unit = unitType === 'spaces' ? '    ' : '\\t';

      const f = parseInt(document.getElementById('indFeature').value) || 0;
      const sc = parseInt(document.getElementById('indScenario').value) || 1;
      const bg = parseInt(document.getElementById('indBackground').value) || 1;
      const g = parseInt(document.getElementById('indGiven').value) || 2;
      const w = parseInt(document.getElementById('indWhen').value) || 2;
      const th = parseInt(document.getElementById('indThen').value) || 3;
      const a = parseInt(document.getElementById('indAnd').value) || 4;
      const b = parseInt(document.getElementById('indBut').value) || 4;
      const ex = parseInt(document.getElementById('indExamples').value) || 2;

      const p = (level, str) => unit.repeat(level) + str;

      const lines = [
        p(f, 'Feature: User Authentication & Dashboard'),
        p(bg, 'Background: Database initialization'),
        p(g, 'Given database connection is open'),
        '',
        p(sc, 'Scenario: Successful login with multi-factor authentication'),
        p(g, 'Given user is on login page'),
        p(w, 'When user enters valid credentials'),
        p(th, 'Then user receives one-time passcode'),
        p(a, 'And security dashboard is displayed'),
        p(b, 'But lockout warning is not triggered'),
        '',
        p(sc, 'Scenario Outline: Role-based permissions'),
        p(g, 'Given user has role "<role>"'),
        p(th, 'Then access level is "<level>"'),
        p(ex, 'Examples:'),
        p(ex + 1, '| role  | level |'),
        p(ex + 1, '| admin | full  |'),
        p(ex + 1, '| guest | read  |'),
      ];

      document.getElementById('livePreview').textContent = lines.join('\\n');
    }

    // Listen to changes for instant live preview
    ['indFeature', 'indScenario', 'indBackground', 'indGiven', 'indWhen', 'indThen', 'indAnd', 'indBut', 'indExamples', 'selIndentChar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', updateLivePreview);
        el.addEventListener('change', updateLivePreview);
      }
    });

    // Presets
    document.getElementById('btnPresetUser').addEventListener('click', () => {
      document.getElementById('indFeature').value = 0;
      document.getElementById('indScenario').value = 1;
      document.getElementById('indBackground').value = 1;
      document.getElementById('indGiven').value = 2;
      document.getElementById('indWhen').value = 2;
      document.getElementById('indThen').value = 3;
      document.getElementById('indAnd').value = 4;
      document.getElementById('indBut').value = 4;
      document.getElementById('indExamples').value = 2;
      updateLivePreview();
    });

    document.getElementById('btnPresetStandard').addEventListener('click', () => {
      document.getElementById('indFeature').value = 0;
      document.getElementById('indScenario').value = 1;
      document.getElementById('indBackground').value = 1;
      document.getElementById('indGiven').value = 2;
      document.getElementById('indWhen').value = 2;
      document.getElementById('indThen').value = 2;
      document.getElementById('indAnd').value = 2;
      document.getElementById('indBut').value = 2;
      document.getElementById('indExamples').value = 2;
      updateLivePreview();
    });

    document.getElementById('btnPresetStrict').addEventListener('click', () => {
      document.getElementById('indFeature').value = 0;
      document.getElementById('indScenario').value = 1;
      document.getElementById('indBackground').value = 1;
      document.getElementById('indGiven').value = 2;
      document.getElementById('indWhen').value = 3;
      document.getElementById('indThen').value = 4;
      document.getElementById('indAnd').value = 5;
      document.getElementById('indBut').value = 5;
      document.getElementById('indExamples').value = 2;
      updateLivePreview();
    });

    document.getElementById('btnProbeAll').addEventListener('click', () => {
      document.getElementById('runtimesGrid').innerHTML = '<div style="grid-column: 1 / -1; font-size: 13px; color: #888;">Probing all language runtimes...</div>';
      vscode.postMessage({ command: 'probeAllRuntimes' });
    });

    document.getElementById('btnProbe').addEventListener('click', () => {
      const box = document.getElementById('probeStatus');
      box.textContent = 'Probing Python & Behave CLI...';
      box.className = 'status-box status-success';
      vscode.postMessage({ command: 'probePython' });
    });

    document.getElementById('btnRebuild').addEventListener('click', () => {
      vscode.postMessage({ command: 'rebuildIndex' });
    });

    const btnOpenEnv = document.getElementById('btnOpenEnv');
    if (btnOpenEnv) {
      btnOpenEnv.addEventListener('click', () => {
        vscode.postMessage({ command: 'openEnvironmentFile' });
      });
    }

    function collectForm() {
      return {
        // Runner
        allowedFiles: document.getElementById('allowedFiles').value,
        arguments: document.getElementById('cliArgs').value,
        extraArgs: document.getElementById('extraArgs').value,
        configDirectory: document.getElementById('configDirectory').value,
        defaultConfigFile: document.getElementById('defaultConfigFile').value,
        autoDiscover: document.getElementById('chkAutoDiscover').checked,
        codeLens: document.getElementById('chkCodeLens').checked,
        justMyCode: document.getElementById('chkJustMyCode').checked,

        // Custom Gherkin Formatter
        formatCustomIndentEnabled: document.getElementById('chkCustomIndentEnabled').checked,
        formatIndentCharacter: document.getElementById('selIndentChar').value,
        formatIndentFeature: parseInt(document.getElementById('indFeature').value) || 0,
        formatIndentScenario: parseInt(document.getElementById('indScenario').value) || 1,
        formatIndentBackground: parseInt(document.getElementById('indBackground').value) || 1,
        formatIndentGiven: parseInt(document.getElementById('indGiven').value) || 2,
        formatIndentWhen: parseInt(document.getElementById('indWhen').value) || 2,
        formatIndentThen: parseInt(document.getElementById('indThen').value) || 3,
        formatIndentAnd: parseInt(document.getElementById('indAnd').value) || 4,
        formatIndentBut: parseInt(document.getElementById('indBut').value) || 4,
        formatIndentExamples: parseInt(document.getElementById('indExamples').value) || 2,
        formatRelativeAnd: document.getElementById('chkRelativeAnd').checked,

        // Cucumber
        cucumberFeatures: document.getElementById('cucumberFeatures').value,
        cucumberGlue: document.getElementById('cucumberGlue').value,
        cucumberParameterTypes: document.getElementById('cucumberParameterTypes').value,
      };
    }

    document.getElementById('btnSaveWorkspace').addEventListener('click', () => {
      vscode.postMessage({ command: 'saveSettings', settings: collectForm(), target: 'workspace' });
    });

    document.getElementById('btnSaveUser').addEventListener('click', () => {
      vscode.postMessage({ command: 'saveSettings', settings: collectForm(), target: 'global' });
    });

    document.getElementById('btnOpenVsCodeSettings').addEventListener('click', () => {
      vscode.postMessage({ command: 'openVsCodeSettings' });
    });
  </script>
</body>
</html>`;
  }
}
