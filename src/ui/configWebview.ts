import * as vscode from "vscode";
import { getPythonInterpreterPath } from "../utils/python";
import { behavesSupportsExplicitNoCaptureStdoutFlag } from "../run/behaveVersion";
import { settings } from "../settings";
import { stepDefinitionIndex } from "../language/stepIndex";
import { featureStepIndex } from "../language/featureStepIndex";
import { behaveTestController } from "../testController";

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
      "smartBehaveConfig",
      "Smart Behave: Configuration & Diagnostics",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    SmartBehaveConfigPanel.currentPanel = new SmartBehaveConfigPanel(panel, extensionUri);
    return SmartBehaveConfigPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "ready":
            this.sendCurrentState();
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
          case "openVsCodeSettings":
            await vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "Smart Behave"
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

    const data = {
      pythonPath: py.path || "Not detected",
      pythonSource: py.source,
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
    };

    void this.panel.webview.postMessage({ command: "state", data });
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

    const updateBoth = async (key: string, val: any) => {
      await smartConfig.update(key, val, target);
      await behaveConfig.update(key, val, target);
    };

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

    void vscode.window.showInformationMessage(
      `Smart Behave: Settings saved successfully to ${targetScope === "workspace" ? "Workspace" : "User"} settings.`
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
      `Smart Behave: Rebuilt indices (${stepDefinitionIndex.getDefinitions().length} step definitions, ${featureStepIndex.getSteps().length} steps found).`
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
  <title>Smart Behave Runner Configuration</title>
  <style>
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 24px;
      line-height: 1.5;
      max-width: 900px;
      margin: 0 auto;
    }
    h1, h2, h3 {
      font-weight: 600;
      color: var(--vscode-titleBar-activeForeground, var(--vscode-foreground));
      border-bottom: 1px solid var(--vscode-widget-border, #333);
      padding-bottom: 6px;
    }
    .header-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      background: var(--vscode-badge-background, #007acc);
      color: var(--vscode-badge-foreground, #fff);
      padding: 2px 8px;
      border-radius: 12px;
      vertical-align: middle;
      margin-left: 8px;
    }
    .card {
      background: var(--vscode-editorWidget-background, rgba(255, 255, 255, 0.04));
      border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 20px;
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
    input[type="text"], textarea {
      background: var(--vscode-input-background, #222);
      color: var(--vscode-input-foreground, #eee);
      border: 1px solid var(--vscode-input-border, #444);
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 13px;
      width: 100%;
      box-sizing: border-box;
    }
    input[type="checkbox"] {
      margin-right: 8px;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
      cursor: pointer;
    }
    button {
      background: var(--vscode-button-background, #007acc);
      color: var(--vscode-button-foreground, #fff);
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
      background: var(--vscode-button-hoverBackground, #0062a3);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #fff);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
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
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .stat-pill {
      background: var(--vscode-badge-background, rgba(255, 255, 255, 0.05));
      border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
      padding: 12px;
      border-radius: 6px;
      text-align: center;
    }
    .stat-pill .num {
      font-size: 22px;
      font-weight: 700;
      color: var(--vscode-textLink-foreground, #3794ff);
    }
    .stat-pill .label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #aaa);
    }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-widget-border, #333);
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888);
      text-align: center;
    }
  </style>
</head>
<body>
  <h1>Smart Behave Runner <span class="header-badge">v1.0.0</span></h1>
  <p>Unified configuration, diagnostics, and environment management for Python Behave BDD testing.</p>

  <div class="card">
    <h2>🐍 Python Environment Status</h2>
    <div class="row">
      <label>Active Python Interpreter</label>
      <input type="text" id="pythonPath" readonly />
      <span class="desc" id="pythonSource">Resolved from environment</span>
    </div>
    <button id="btnProbe">Probe Behave CLI</button>
    <div id="probeStatus" class="status-box"></div>
  </div>

  <div class="card">
    <h2>📊 Indexing & Test Discovery</h2>
    <div class="stats-grid">
      <div class="stat-pill">
        <div class="num" id="statSteps">0</div>
        <div class="label">Indexed Step Definitions</div>
      </div>
      <div class="stat-pill">
        <div class="num" id="statFeatures">0</div>
        <div class="label">Feature Steps in Workspace</div>
      </div>
    </div>
    <div style="margin-top: 14px;">
      <button id="btnRebuild" class="secondary">Rebuild Step & Feature Index</button>
    </div>
  </div>

  <div class="card">
    <h2>⚙️ Runner Configuration</h2>
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
      <span class="desc">Directory path relative to project workspace root where config/capabilities files are stored (default: configs)</span>
      <input type="text" id="configDirectory" />
    </div>

    <div class="row">
      <label>Default Configuration File (caps_file)</label>
      <span class="desc">Default config file relative path (e.g. configs/ios_caps_v5.json). If empty, Smart Behave prompts you to pick one when running tests</span>
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

    <div style="margin-top: 16px;">
      <button id="btnSaveWorkspace">Save to Workspace Settings</button>
      <button id="btnSaveUser" class="secondary">Save to User Settings</button>
      <button id="btnOpenVsCodeSettings" class="secondary">Open in VS Code Settings UI</button>
    </div>
  </div>

  <div class="footer">
    Smart Behave Runner • Combining the best of <strong>simplytest/behave-vsc</strong> and <strong>RemoYukoff/behave-runner</strong> • MIT License
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    window.addEventListener('load', () => {
      vscode.postMessage({ command: 'ready' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'state') {
        document.getElementById('pythonPath').value = msg.data.pythonPath;
        document.getElementById('pythonSource').textContent = 'Source: ' + msg.data.pythonSource;
        document.getElementById('allowedFiles').value = msg.data.allowedFiles;
        document.getElementById('cliArgs').value = msg.data.arguments;
        document.getElementById('extraArgs').value = msg.data.extraArgs;
        document.getElementById('configDirectory').value = msg.data.configDirectory || '';
        document.getElementById('defaultConfigFile').value = msg.data.defaultConfigFile || '';
        document.getElementById('chkAutoDiscover').checked = msg.data.autoDiscover;
        document.getElementById('chkCodeLens').checked = msg.data.codeLens;
        document.getElementById('chkJustMyCode').checked = msg.data.justMyCode;
        document.getElementById('statSteps').textContent = msg.data.indexedSteps;
        document.getElementById('statFeatures').textContent = msg.data.indexedFeatures;
      } else if (msg.command === 'probeResult') {
        const box = document.getElementById('probeStatus');
        box.textContent = msg.message;
        box.className = 'status-box ' + (msg.success ? 'status-success' : 'status-error');
      }
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

    function collectForm() {
      return {
        allowedFiles: document.getElementById('allowedFiles').value,
        arguments: document.getElementById('cliArgs').value,
        extraArgs: document.getElementById('extraArgs').value,
        configDirectory: document.getElementById('configDirectory').value,
        defaultConfigFile: document.getElementById('defaultConfigFile').value,
        autoDiscover: document.getElementById('chkAutoDiscover').checked,
        codeLens: document.getElementById('chkCodeLens').checked,
        justMyCode: document.getElementById('chkJustMyCode').checked,
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
