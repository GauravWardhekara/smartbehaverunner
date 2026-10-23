import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LOG } from "../log";

export interface CompletedStepRecord {
  keyword: string;
  text: string;
  status: "passed" | "failed" | "skipped" | "undefined";
  error?: string;
  durationMs?: number;
}

export interface TestArtifact {
  name: string;
  type: "screenshot" | "dom_dump" | "other";
  filePath: string;
  relativePath?: string;
  fileSize?: number;
  dataUri?: string;
  snippet?: string;
  content?: string;
}

export interface CompletedTestRecord {
  id: string;
  featureName: string;
  featureFilePath: string;
  relativeFilePath: string;
  scenarioName: string;
  scenarioLine: number;
  status: "passed" | "failed" | "skipped" | "cancelled";
  durationMs: number;
  timestamp: number;
  dateFormatted: string;
  capsFile?: string;
  errorMessage?: string;
  errorStep?: string;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  steps: CompletedStepRecord[];
  artifacts?: TestArtifact[];
}

export interface ResultsSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  lastRunTimestamp?: number;
}

const RESULTS_STORAGE_KEY = "cucumberBehave.completedResults.v2";
const MAX_STORED_RECORDS = 200;

class BehaveResultsManager {
  private workspaceState?: vscode.Memento;
  private records: CompletedTestRecord[] = [];
  private readonly changeListeners = new Set<() => void>();
  private readonly claimedArtifactPaths = new Set<string>();

  public initialize(context: vscode.ExtensionContext): void {
    this.workspaceState = context.workspaceState;
    const saved = this.workspaceState.get<CompletedTestRecord[]>(RESULTS_STORAGE_KEY);
    if (Array.isArray(saved)) {
      this.records = saved;
    }
  }

  public onDidChange(listener: () => void): vscode.Disposable {
    this.changeListeners.add(listener);
    return new vscode.Disposable(() => this.changeListeners.delete(listener));
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (err) {
        LOG.warn("Error in results change listener:", err);
      }
    }
  }

  /**
   * Scans candidate directories to discover screenshots and DOM dumps created on test failure.
   * Scoped strictly to the specific test execution instance so artifacts from other tests are not leaked.
   */
  public findFailureArtifacts(
    scenario: {
      scenarioName: string;
      featureName?: string;
      timestamp?: number;
      durationMs?: number;
      featureFilePath?: string;
    },
    workspaceRoot?: string
  ): TestArtifact[] {
    const root =
      workspaceRoot ||
      (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());

    // Candidate directories where screenshots and dom dumps may be saved
    const candidateDirs = [
      path.join(root, "reports", "screenshots"),
      path.join(root, "screenshots"),
      path.join(root, "reports", "dom_dumps"),
      path.join(root, "reports", "dom"),
      path.join(root, "reports", "page_source"),
      path.join(root, "dom_dumps"),
      path.join(root, "dom"),
      path.join(root, "page_source"),
      path.join(root, "reports"),
      path.join(root, "allure-results")
    ];

    if (scenario.featureFilePath) {
      candidateDirs.push(path.dirname(scenario.featureFilePath));
    }

    const seenPaths = new Set<string>();

    // Exact execution window for this specific test execution instance
    const endTime = scenario.timestamp || Date.now();
    const duration = scenario.durationMs && scenario.durationMs > 0 ? scenario.durationMs : 3000;
    const startTime = endTime - duration;
    // 2s lead before start and 8s teardown buffer after scenario end
    const instanceWindowStart = startTime - 2000;
    const instanceWindowEnd = endTime + 8000;

    const scNameLower = scenario.scenarioName.toLowerCase();
    const scSlug = scenario.scenarioName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const scCompact = scNameLower.replace(/[^a-z0-9]/g, "");

    // Identify slugs and compact names belonging to OTHER scenarios in this run
    // to strictly prevent cross-scenario artifact association
    const otherScenarioIdentifiers = new Set<string>();
    for (const r of this.records) {
      if (r.scenarioName && r.scenarioName.toLowerCase() !== scNameLower) {
        const otherSlug = r.scenarioName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        const otherCompact = r.scenarioName.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (otherSlug.length >= 4) otherScenarioIdentifiers.add(otherSlug);
        if (otherCompact.length >= 4) otherScenarioIdentifiers.add(otherCompact);
      }
    }

    interface CandidateMatch {
      artifact: TestArtifact;
      score: number;
    }

    const screenshotCandidates: CandidateMatch[] = [];
    const domCandidates: CandidateMatch[] = [];

    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const fullPath = path.join(dir, entry.name);
          const resolvedPath = path.resolve(fullPath);

          if (seenPaths.has(resolvedPath)) continue;
          // Skip if artifact was already claimed by another test execution instance
          if (this.claimedArtifactPaths.has(resolvedPath)) continue;

          const ext = path.extname(entry.name).toLowerCase();
          const nameLower = entry.name.toLowerCase();
          const fileCompact = nameLower.replace(/[^a-z0-9]/g, "");

          // Determine artifact type
          let type: "screenshot" | "dom_dump" | undefined;
          if ([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"].includes(ext)) {
            type = "screenshot";
          } else if (
            [".html", ".xml", ".dom", ".htm", ".txt", ".json"].includes(ext) &&
            (nameLower.includes("dom") ||
              nameLower.includes("dump") ||
              nameLower.includes("page_source") ||
              nameLower.includes("source") ||
              nameLower.includes("attachment") ||
              dir.toLowerCase().includes("dom") ||
              dir.toLowerCase().includes("page_source"))
          ) {
            type = "dom_dump";
          }

          if (!type) continue;

          let stats: fs.Stats | undefined;
          try {
            stats = fs.statSync(fullPath);
          } catch {
            continue;
          }

          const mtime = stats.mtimeMs;

          // Check if file clearly belongs to another scenario in the test run
          let belongsToOtherScenario = false;
          for (const otherId of otherScenarioIdentifiers) {
            if (nameLower.includes(otherId) || fileCompact.includes(otherId)) {
              belongsToOtherScenario = true;
              break;
            }
          }
          if (belongsToOtherScenario) {
            continue;
          }

          // Check matching for this specific test execution instance
          const isDirectNameMatch =
            nameLower.includes(scSlug) ||
            nameLower.includes(scNameLower) ||
            (scCompact.length >= 4 && fileCompact.includes(scCompact));

          const isWithinInstanceWindow =
            mtime >= instanceWindowStart && mtime <= instanceWindowEnd;

          let score = 0;
          if (isDirectNameMatch) {
            // Strong name match: check recency to prevent attaching files from days ago
            const timeDelta = Math.abs(mtime - endTime);
            if (timeDelta <= 1_800_000) { // within 30 minutes
              score = 1000 - Math.min(400, Math.round(timeDelta / 1000));
            }
          } else if (isWithinInstanceWindow) {
            // Generic/unnamed file generated strictly during this test execution instance
            const timeDelta = Math.abs(mtime - endTime);
            score = 500 - Math.min(300, Math.round(timeDelta / 1000));
          }

          if (score <= 0) continue;

          seenPaths.add(resolvedPath);
          const relPath = path.relative(root, fullPath).replace(/\\/g, "/");

          let dataUri: string | undefined;
          if (type === "screenshot" && stats.size <= 3_000_000) {
            try {
              const buf = fs.readFileSync(fullPath);
              const mime =
                ext === ".png"
                  ? "image/png"
                  : ext === ".jpg" || ext === ".jpeg"
                    ? "image/jpeg"
                    : "image/png";
              dataUri = `data:${mime};base64,${buf.toString("base64")}`;
            } catch {
              /* ignore */
            }
          }

          let content: string | undefined;
          let snippet: string | undefined;
          if (type === "dom_dump") {
            try {
              const raw = fs.readFileSync(fullPath, "utf-8");
              content =
                raw.length > 4_000_000
                  ? raw.slice(0, 4_000_000) + "\n<!-- [DOM dump exceeds 4MB, truncated] -->"
                  : raw;
              snippet = content.slice(0, 3000);
            } catch {
              /* ignore */
            }
          }

          const artifact: TestArtifact = {
            name: entry.name,
            type,
            filePath: fullPath,
            relativePath: relPath,
            fileSize: stats.size,
            dataUri,
            snippet,
            content
          };

          if (type === "screenshot") {
            screenshotCandidates.push({ artifact, score });
          } else if (type === "dom_dump") {
            domCandidates.push({ artifact, score });
          }
        }
      } catch {
        /* ignore folder read errors */
      }
    }

    // Pick top matching screenshot and top matching DOM dump for this execution instance
    const selected: TestArtifact[] = [];

    if (screenshotCandidates.length > 0) {
      screenshotCandidates.sort((a, b) => b.score - a.score);
      const topShot = screenshotCandidates[0].artifact;
      selected.push(topShot);
      this.claimedArtifactPaths.add(path.resolve(topShot.filePath));
    }

    if (domCandidates.length > 0) {
      domCandidates.sort((a, b) => b.score - a.score);
      const topDom = domCandidates[0].artifact;
      selected.push(topDom);
      this.claimedArtifactPaths.add(path.resolve(topDom.filePath));
    }

    return selected;
  }

  public recordScenario(data: Omit<CompletedTestRecord, "id" | "dateFormatted">): CompletedTestRecord {
    const id = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const date = new Date(data.timestamp || Date.now());
    const dateFormatted = date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    let artifacts = data.artifacts;
    if ((!artifacts || artifacts.length === 0) && data.status === "failed") {
      const found = this.findFailureArtifacts(data);
      if (found.length > 0) {
        artifacts = found;
      }
    } else if (artifacts && artifacts.length > 0) {
      for (const a of artifacts) {
        if (a.filePath) {
          this.claimedArtifactPaths.add(path.resolve(a.filePath));
        }
      }
    }

    const record: CompletedTestRecord = {
      ...data,
      id,
      dateFormatted,
      artifacts
    };

    // Prepend new record (most recent first)
    this.records.unshift(record);
    if (this.records.length > MAX_STORED_RECORDS) {
      this.records = this.records.slice(0, MAX_STORED_RECORDS);
    }

    void this.persist();
    this.notifyChange();
    return record;
  }

  public getRecords(
    sort: "date_desc" | "date_asc" | "feature" | "scenario" = "date_desc",
    filterStatus?: string
  ): CompletedTestRecord[] {
    let result = [...this.records];
    if (filterStatus && filterStatus !== "all") {
      result = result.filter((r) => r.status === filterStatus);
    }

    switch (sort) {
      case "date_desc":
        result.sort((a, b) => b.timestamp - a.timestamp);
        break;
      case "date_asc":
        result.sort((a, b) => a.timestamp - b.timestamp);
        break;
      case "feature":
        result.sort((a, b) => a.featureName.localeCompare(b.featureName) || b.timestamp - a.timestamp);
        break;
      case "scenario":
        result.sort((a, b) => a.scenarioName.localeCompare(b.scenarioName) || b.timestamp - a.timestamp);
        break;
    }

    return result;
  }

  public getSummary(): ResultsSummary {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let cancelled = 0;

    for (const r of this.records) {
      if (r.status === "passed") passed++;
      else if (r.status === "failed") failed++;
      else if (r.status === "skipped") skipped++;
      else if (r.status === "cancelled") cancelled++;
    }

    return {
      total: this.records.length,
      passed,
      failed,
      skipped,
      cancelled,
      lastRunTimestamp: this.records[0]?.timestamp
    };
  }

  public clearRecords(): void {
    this.records = [];
    this.claimedArtifactPaths.clear();
    void this.persist();
    this.notifyChange();
  }

  private async persist(): Promise<void> {
    if (this.workspaceState) {
      try {
        await this.workspaceState.update(RESULTS_STORAGE_KEY, this.records);
      } catch (err) {
        LOG.warn("Failed to persist test results:", err);
      }
    }
  }

  /**
   * Generates an Allure Report using the latest Allure CLI (allure-commandline).
   * If `allure` CLI is not found in PATH, returns success: false with an error message detailing
   * the installation instructions (e.g. npm install -g allure-commandline@latest or scoop install allure).
   */
  public async generateAllureReport(
    workspaceRoot?: string
  ): Promise<{ success: boolean; reportPath: string; message: string; usedCli: boolean; missingCli?: boolean }> {
    const root = workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const reportsDir = path.join(root, "reports", "allure-report");
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportIndexPath = path.join(reportsDir, "index.html");

    // 0. Ensure already populated scenario artifacts are claimed
    for (const r of this.records) {
      if (r.artifacts) {
        for (const a of r.artifacts) {
          if (a.filePath) {
            this.claimedArtifactPaths.add(path.resolve(a.filePath));
          }
        }
      }
    }

    // Discover and link failure artifacts for failed scenarios that do not yet have artifacts
    for (const r of this.records) {
      if (r.status === "failed" && (!r.artifacts || r.artifacts.length === 0)) {
        const found = this.findFailureArtifacts(r, root);
        if (found.length > 0) {
          r.artifacts = found;
        }
      }
    }

    // 1. Check if allure CLI is available in PATH
    let hasAllureCli = false;
    let allureVersion = "";
    try {
      const verBuf = cp.execSync("allure --version", { stdio: "pipe" });
      allureVersion = verBuf.toString().trim();
      hasAllureCli = true;
    } catch {
      hasAllureCli = false;
    }

    if (!hasAllureCli) {
      // Generate standalone preview so test data is captured
      const htmlContent = this.generateStandaloneAllureHtml(this.records, root);
      fs.writeFileSync(reportIndexPath, htmlContent, "utf-8");

      const errorMsg =
        "Allure CLI was not found in PATH. Please install the latest Allure CLI: 'npm install -g allure-commandline@latest' (or 'scoop install allure') and ensure 'allure' is accessible in PATH. A standalone HTML preview report was generated at reports/allure-report/index.html.";
      return {
        success: false,
        reportPath: reportIndexPath,
        message: errorMsg,
        usedCli: false,
        missingCli: true
      };
    }

    // 2. Look for allure-results directory produced by allure-behave
    const candidateResultsDirs = [
      path.join(root, "allure-results"),
      path.join(root, "reports", "allure-results"),
      path.join(root, "target", "allure-results")
    ];
    let foundResultsDir: string | undefined;
    for (const dir of candidateResultsDirs) {
      if (fs.existsSync(dir)) {
        foundResultsDir = dir;
        break;
      }
    }

    let usedCli = false;
    if (foundResultsDir) {
      try {
        cp.execSync(`allure generate "${foundResultsDir}" -o "${reportsDir}" --clean`, {
          cwd: root,
          stdio: "pipe"
        });
        usedCli = true;
      } catch (err) {
        LOG.warn("Allure CLI generation failed, falling back to standalone generator:", err);
      }
    }

    // 3. If Allure CLI was not used or failed (e.g. no allure-results yet), generate the standalone Allure-style HTML report
    if (!usedCli || !fs.existsSync(reportIndexPath)) {
      const htmlContent = this.generateStandaloneAllureHtml(this.records, root);
      fs.writeFileSync(reportIndexPath, htmlContent, "utf-8");
    }

    const msg = usedCli
      ? `Allure Report generated successfully via Allure CLI ${allureVersion ? `(v${allureVersion})` : ""} in ${reportsDir}`
      : `Generated Allure-style HTML Report in ${reportsDir}. (Tip: Run Behave with '-f allure_behave.formatter:AllureFormatter -o allure-results' to produce native Allure data for Allure CLI v${allureVersion || "latest"}).`;

    return {
      success: true,
      reportPath: reportIndexPath,
      message: msg,
      usedCli
    };
  }

  /**
   * Opens the generated Allure Report in browser.
   */
  public async viewAllureReport(workspaceRoot?: string): Promise<void> {
    const root = workspaceRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const reportsDir = path.join(root, "reports", "allure-report");
    const reportIndexPath = path.join(reportsDir, "index.html");

    if (!fs.existsSync(reportIndexPath)) {
      const genResult = await this.generateAllureReport(root);
      if (!genResult.success) {
        void vscode.window.showErrorMessage("Failed to generate Allure Report.");
        return;
      }
    }

    try {
      const uri = vscode.Uri.file(reportIndexPath);
      await vscode.env.openExternal(uri);
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not open Allure Report: ${err}`);
    }
  }

  /**
   * Highlights HTML/XML markup with high-contrast syntax tokens for in-report DOM viewing.
   */
  public highlightDomHtml(raw: string): string {
    if (!raw) return "";
    if (raw.length > 2_000_000) {
      return this.escapeHtml(raw);
    }

    let escaped = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Highlight XML declarations / processing instructions (e.g. <?xml ... ?>)
    escaped = escaped.replace(/(&lt;\?[\s\S]*?\?&gt;)/g, '<span class="dom-comment">$1</span>');

    // Highlight comments (e.g. <!-- ... -->)
    escaped = escaped.replace(
      /(&lt;!--[\s\S]*?--&gt;)/g,
      '<span class="dom-comment">$1</span>'
    );

    // Highlight XML/HTML tags and attributes with rich contrast tokens
    escaped = escaped.replace(
      /(&lt;\/?)([a-zA-Z0-9_:-]+)([\s\S]*?)(\/?&gt;)/g,
      (_match, open, tagName, attrs, close) => {
        const highlightedAttrs = attrs.replace(
          /([a-zA-Z0-9_:-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g,
          '<span class="dom-attr">$1</span>$2<span class="dom-val">$3</span>'
        );
        return `${open}<span class="dom-tag">${tagName}</span>${highlightedAttrs}${close}`;
      }
    );

    return escaped;
  }

  private renderArtifactsHtml(sc: CompletedTestRecord, reportsDir: string): string {
    const artifacts = sc.artifacts || [];
    if (artifacts.length === 0) {
      return "";
    }

    const attachmentsDir = path.join(reportsDir, "attachments");
    if (!fs.existsSync(attachmentsDir)) {
      try {
        fs.mkdirSync(attachmentsDir, { recursive: true });
      } catch {
        /* ignore */
      }
    }

    const itemsHtml = artifacts
      .map((art, index) => {
        const destFile = path.join(attachmentsDir, path.basename(art.filePath));
        if (fs.existsSync(art.filePath) && !fs.existsSync(destFile)) {
          try {
            fs.copyFileSync(art.filePath, destFile);
          } catch {
            /* ignore */
          }
        }

        const relativeUrl = `attachments/${encodeURIComponent(path.basename(art.filePath))}`;
        const sizeStr = art.fileSize ? `${Math.round(art.fileSize / 1024)} KB` : "";
        const imgSrc = art.dataUri || relativeUrl;

        if (art.type === "screenshot") {
          return `
          <div class="attachment-card attachment-screenshot">
            <div class="attachment-top">
              <span class="attachment-badge badge-screenshot">📸 Screenshot</span>
              <span class="attachment-filename" title="${this.escapeHtml(art.filePath)}">${this.escapeHtml(art.name)}</span>
              ${sizeStr ? `<span class="attachment-size">${sizeStr}</span>` : ""}
            </div>
            <div class="screenshot-thumb-container">
              <img src="${imgSrc}" alt="Failure Screenshot: ${this.escapeHtml(art.name)}" class="screenshot-thumb" />
            </div>
          </div>`;
        }

        if (art.type === "dom_dump") {
          const domId = `dom_${sc.id}_${index}`;
          let fullDomText = art.content;
          if (!fullDomText && fs.existsSync(art.filePath)) {
            try {
              fullDomText = fs.readFileSync(art.filePath, "utf-8");
            } catch {
              /* ignore */
            }
          }
          if (!fullDomText) {
            fullDomText = art.snippet || "No DOM content captured";
          }

          const lineCount = fullDomText.split(/\r\n|\r|\n/).length;
          const highlightedDom = this.highlightDomHtml(fullDomText);
          const safeRawScript = fullDomText.replace(/<\/script/gi, "<\\/script");

          return `
          <div class="attachment-card attachment-dom">
            <div class="dom-section">
              <div class="dom-header">
                <div class="dom-title-bar">
                  <span class="attachment-badge badge-dom">📄 Complete DOM Dump</span>
                  <span class="dom-filename" title="${this.escapeHtml(art.filePath)}">${this.escapeHtml(art.name)}</span>
                  <span class="dom-size-badge">${sizeStr ? `${sizeStr} • ` : ""}${lineCount} lines</span>
                </div>
                <div class="dom-header-actions">
                  <button type="button" class="dom-action-btn dom-toggle-btn" onclick="toggleDomCollapse('${domId}', this)">
                    <span>▶ View Complete DOM (Expand)</span>
                  </button>
                  <button type="button" class="dom-action-btn" onclick="copyDomCode('${domId}', this)" title="Copy entire DOM to clipboard">
                    <span>📋 Copy DOM</span>
                  </button>
                  <button type="button" class="dom-action-btn dom-wrap-btn" onclick="toggleDomWrap('${domId}', this)" title="Toggle word wrap">
                    <span class="wrap-icon">↔</span> <span class="wrap-label">Unwrap Lines</span>
                  </button>
                </div>
              </div>
              <div id="${domId}" class="dom-viewer-body collapsed">
                <pre id="pre-${domId}" class="dom-code-view wrap"><code id="code-${domId}">${highlightedDom}</code></pre>
              </div>
              <script type="text/plain" id="raw-${domId}">${safeRawScript}</script>
            </div>
          </div>`;
        }

        return `
        <div class="attachment-card">
          <div class="attachment-top">
            <span class="attachment-badge">📎 Artifact</span>
            <span class="attachment-filename">${this.escapeHtml(art.name)}</span>
          </div>
        </div>`;
      })
      .join("");

    return `
    <div class="scenario-attachments">
      <div class="attachments-header">
        <span>📎 Test Failure Artifacts (${artifacts.length})</span>
      </div>
      <div class="attachments-grid">
        ${itemsHtml}
      </div>
    </div>`;
  }

  /**
   * Generates a modern, standalone Allure-style interactive HTML report.
   */
  private generateStandaloneAllureHtml(records: CompletedTestRecord[], workspaceRoot: string): string {
    const summary = this.getSummary();
    const passRate = summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;
    const nowStr = new Date().toLocaleString();
    const reportsDir = path.join(workspaceRoot, "reports", "allure-report");

    // Group by feature
    const featuresMap = new Map<string, CompletedTestRecord[]>();
    for (const r of records) {
      const list = featuresMap.get(r.featureName) || [];
      list.push(r);
      featuresMap.set(r.featureName, list);
    }

    const featureRowsHtml = Array.from(featuresMap.entries())
      .map(([featureName, scList]) => {
        const featPassed = scList.filter((s) => s.status === "passed").length;
        const featFailed = scList.filter((s) => s.status === "failed").length;
        const featStatus = featFailed > 0 ? "failed" : "passed";

        const scenariosHtml = scList
          .map((sc) => {
            const scStatusClass = sc.status;
            const stepsHtml = (sc.steps || [])
              .map(
                (st) => `
              <li class="step-item step-${st.status}">
                <span class="step-keyword">${this.escapeHtml(st.keyword)}</span>
                <span class="step-text">${this.escapeHtml(st.text)}</span>
                <span class="step-status-badge badge-${st.status}">${st.status}</span>
                ${st.error ? `<pre class="step-error">${this.escapeHtml(st.error)}</pre>` : ""}
              </li>`
              )
              .join("");

            return `
            <div class="scenario-card status-${scStatusClass}">
              <div class="scenario-header" onclick="this.parentElement.classList.toggle('open')">
                <div class="scenario-title">
                  <span class="status-indicator indicator-${scStatusClass}"></span>
                  <span class="scenario-name">${this.escapeHtml(sc.scenarioName)}</span>
                  <span class="scenario-time">${sc.dateFormatted} (${(sc.durationMs / 1000).toFixed(2)}s)</span>
                </div>
                <div class="scenario-meta">
                  ${sc.capsFile ? `<span class="meta-caps">⚙ ${this.escapeHtml(sc.capsFile)}</span>` : ""}
                  <span class="meta-steps">${sc.passedSteps}/${sc.totalSteps} steps</span>
                  <span class="expand-arrow">▼</span>
                </div>
              </div>
              <div class="scenario-body">
                ${sc.errorMessage ? `<div class="failure-box"><strong>Error:</strong> ${this.escapeHtml(sc.errorMessage)}</div>` : ""}
                ${this.renderArtifactsHtml(sc, reportsDir)}
                <ul class="steps-list">
                  ${stepsHtml || "<li class='no-steps'>No recorded step details</li>"}
                </ul>
              </div>
            </div>`;
          })
          .join("");

        return `
        <div class="feature-suite feature-${featStatus}">
          <div class="feature-header" onclick="this.parentElement.classList.toggle('collapsed')">
            <div class="feature-title-group">
              <span class="suite-status-pill pill-${featStatus}">${featStatus.toUpperCase()}</span>
              <h3 class="feature-name">${this.escapeHtml(featureName)}</h3>
            </div>
            <div class="feature-counts">
              <span class="count-passed">${featPassed} Passed</span>
              ${featFailed > 0 ? `<span class="count-failed">${featFailed} Failed</span>` : ""}
              <span class="count-total">${scList.length} Scenarios</span>
              <span class="suite-arrow">▼</span>
            </div>
          </div>
          <div class="feature-scenarios">
            ${scenariosHtml}
          </div>
        </div>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cucumber-Behave Allure Report</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-bright: #ffffff;
      --text-muted: #8b949e;
      --pass: #238636;
      --pass-light: #2ea043;
      --fail: #da3633;
      --fail-light: #f85149;
      --accent: #58a6ff;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      padding: 24px;
      line-height: 1.5;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 24px;
    }
    .logo-title { display: flex; align-items: center; gap: 12px; }
    .logo-badge {
      background: linear-gradient(135deg, #238636, #1f6feb);
      color: white;
      font-weight: 700;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 16px;
    }
    h1 { font-size: 24px; color: var(--text-bright); }
    .header-meta { font-size: 13px; color: var(--text-muted); text-align: right; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .summary-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
    }
    .summary-card .label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    .summary-card .value { font-size: 28px; font-weight: 700; color: var(--text-bright); margin-top: 6px; }
    .summary-card.pass .value { color: var(--pass-light); }
    .summary-card.fail .value { color: var(--fail-light); }
    .summary-card.rate .value { color: var(--accent); }
    .progress-bar-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 28px;
    }
    .progress-bar {
      height: 12px;
      background: #21262d;
      border-radius: 6px;
      overflow: hidden;
      display: flex;
      margin-top: 8px;
    }
    .progress-pass { background: var(--pass-light); height: 100%; }
    .progress-fail { background: var(--fail-light); height: 100%; }
    .filter-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      align-items: center;
      flex-wrap: wrap;
    }
    .search-input {
      flex: 1;
      min-width: 240px;
      background: #21262d;
      border: 1px solid var(--border);
      color: var(--text-bright);
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 13px;
      outline: none;
    }
    .filter-btn {
      background: #21262d;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .filter-btn.active {
      background: var(--accent);
      color: white;
      border-color: var(--accent);
    }
    .feature-suite {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .feature-header {
      padding: 14px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
      background: #1c2128;
    }
    .feature-title-group { display: flex; align-items: center; gap: 12px; }
    .suite-status-pill {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 12px;
    }
    .pill-passed { background: rgba(46, 160, 67, 0.2); color: var(--pass-light); }
    .pill-failed { background: rgba(248, 81, 73, 0.2); color: var(--fail-light); }
    .feature-name { font-size: 15px; color: var(--text-bright); }
    .feature-counts { display: flex; align-items: center; gap: 14px; font-size: 13px; color: var(--text-muted); }
    .count-passed { color: var(--pass-light); font-weight: 600; }
    .count-failed { color: var(--fail-light); font-weight: 600; }
    .suite-arrow { transition: transform 0.2s; font-size: 12px; }
    .feature-suite.collapsed .suite-arrow { transform: rotate(-90deg); }
    .feature-suite.collapsed .feature-scenarios { display: none; }
    .feature-scenarios { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
    .scenario-card {
      border: 1px solid #21262d;
      border-radius: 6px;
      background: #0d1117;
      overflow: hidden;
    }
    .scenario-header {
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }
    .scenario-title { display: flex; align-items: center; gap: 10px; }
    .status-indicator { width: 10px; height: 10px; border-radius: 50%; }
    .indicator-passed { background: var(--pass-light); }
    .indicator-failed { background: var(--fail-light); }
    .scenario-name { font-size: 13px; font-weight: 600; color: var(--text-bright); }
    .scenario-time { font-size: 12px; color: var(--text-muted); }
    .scenario-meta { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-muted); }
    .meta-caps { background: #21262d; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
    .expand-arrow { transition: transform 0.2s; font-size: 10px; }
    .scenario-card.open .expand-arrow { transform: rotate(180deg); }
    .scenario-body { display: none; padding: 12px 16px 14px 34px; border-top: 1px solid #21262d; }
    .scenario-card.open .scenario-body { display: block; }
    .failure-box {
      background: rgba(248, 81, 73, 0.1);
      border: 1px solid rgba(248, 81, 73, 0.3);
      color: #ff7b72;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 12px;
      font-family: monospace;
      white-space: pre-wrap;
    }
    .steps-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
    .step-item { display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap; }
    .step-keyword { font-weight: 700; color: #79c0ff; min-width: 50px; }
    .step-text { color: var(--text); flex: 1; }
    .step-status-badge { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
    .badge-passed { background: rgba(46, 160, 67, 0.2); color: var(--pass-light); }
    .badge-failed { background: rgba(248, 81, 73, 0.2); color: var(--fail-light); }
    .badge-skipped { background: rgba(139, 148, 158, 0.2); color: var(--text-muted); }
    .step-error { width: 100%; background: #161b22; border: 1px solid #30363d; border-radius: 4px; padding: 8px 12px; margin-top: 4px; color: #f85149; font-size: 12px; font-family: monospace; white-space: pre-wrap; }

    /* Failure Artifacts (Screenshots & In-Report DOM Dumps) */
    .scenario-attachments {
      margin: 12px 0 16px;
      padding: 12px 14px;
      background: #161b22;
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    .attachments-header {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-bright);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .attachments-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .attachment-card {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .attachment-card.attachment-dom {
      padding: 0;
      background: transparent;
      border: none;
    }
    .attachment-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .attachment-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 12px;
    }
    .badge-screenshot {
      background: rgba(88, 166, 255, 0.2);
      color: #58a6ff;
      border: 1px solid rgba(88, 166, 255, 0.4);
    }
    .badge-dom {
      background: rgba(210, 153, 34, 0.25);
      color: #f2cc60;
      border: 1px solid rgba(210, 153, 34, 0.5);
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 12px;
      letter-spacing: 0.3px;
    }
    .attachment-filename {
      font-size: 12px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
    }
    .attachment-size {
      font-size: 11px;
      color: var(--text-muted);
    }
    .screenshot-thumb-container {
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid #30363d;
      background: #010409;
      text-align: center;
      padding: 4px;
    }
    .screenshot-thumb {
      max-width: 100%;
      max-height: 240px;
      display: block;
      margin: 0 auto;
      object-fit: contain;
      border-radius: 2px;
    }

    /* Complete In-Report DOM Viewer with High Contrast */
    .dom-section {
      width: 100%;
      border: 1px solid #30363d;
      border-radius: 6px;
      background: #0d1117;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
    .dom-header {
      padding: 10px 14px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .dom-title-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .dom-filename {
      font-size: 12px;
      font-family: Consolas, monospace;
      color: #f0f6fc;
      font-weight: 600;
    }
    .dom-size-badge {
      font-size: 11px;
      color: #c9d1d9;
      background: #21262d;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid #30363d;
      font-weight: 500;
    }
    .dom-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .dom-action-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #21262d;
      border: 1px solid #30363d;
      color: #f0f6fc;
      padding: 5px 12px;
      border-radius: 5px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
    }
    .dom-action-btn:hover {
      background: #30363d;
      border-color: #58a6ff;
      color: #58a6ff;
    }
    .dom-toggle-btn {
      background: #1f6feb;
      border-color: #388bfd;
      color: #ffffff;
    }
    .dom-toggle-btn:hover {
      background: #388bfd;
      border-color: #58a6ff;
      color: #ffffff;
    }
    .dom-toggle-btn.expanded {
      background: #30363d;
      border-color: #6e7681;
      color: #f0f6fc;
    }
    .dom-viewer-body {
      background: #0d1117;
      max-height: 560px;
      overflow-y: auto;
      overflow-x: auto;
      padding: 14px 18px;
      border-top: 1px solid #21262d;
      box-sizing: border-box;
    }
    .dom-viewer-body.collapsed {
      display: none;
    }
    .dom-code-view {
      margin: 0;
      font-family: "SF Mono", Consolas, "Liberation Mono", Menlo, Courier, monospace;
      font-size: 12px;
      line-height: 1.65;
      color: #f0f6fc;
      background: transparent;
      tab-size: 2;
      /* By default wrap lines so long lines and all attributes are 100% visible */
      white-space: pre-wrap !important;
      word-break: break-word !important;
      overflow-wrap: anywhere !important;
    }
    .dom-code-view.nowrap {
      white-space: pre !important;
      word-break: normal !important;
      overflow-wrap: normal !important;
    }
    .dom-tag { color: #7ee787; font-weight: 700; }
    .dom-attr { color: #79c0ff; font-weight: 600; }
    .dom-val { color: #ffab70; font-weight: 500; }
    .dom-comment { color: #8b949e; font-style: italic; }

    footer { margin-top: 40px; text-align: center; font-size: 12px; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-title">
        <div class="logo-badge">BDD</div>
        <div>
          <h1>Cucumber-Behave Test Execution & Allure Report</h1>
          <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Workspace: ${this.escapeHtml(path.basename(workspaceRoot))}</div>
        </div>
      </div>
      <div class="header-meta">
        <div>Generated: ${nowStr}</div>
        <div>Engine: Smart Cucumber-Behave Runner</div>
      </div>
    </header>

    <div class="summary-grid">
      <div class="summary-card">
        <div class="label">Total Scenarios</div>
        <div class="value">${summary.total}</div>
      </div>
      <div class="summary-card pass">
        <div class="label">Passed</div>
        <div class="value">${summary.passed}</div>
      </div>
      <div class="summary-card fail">
        <div class="label">Failed</div>
        <div class="value">${summary.failed}</div>
      </div>
      <div class="summary-card rate">
        <div class="label">Success Rate</div>
        <div class="value">${passRate}%</div>
      </div>
    </div>

    <div class="progress-bar-container">
      <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-muted);">
        <span>Execution Distribution</span>
        <span>${summary.passed} passed / ${summary.failed} failed</span>
      </div>
      <div class="progress-bar">
        <div class="progress-pass" style="width: ${passRate}%;"></div>
        <div class="progress-fail" style="width: ${100 - passRate}%;"></div>
      </div>
    </div>

    <div class="filter-bar">
      <input type="text" id="reportSearch" class="search-input" placeholder="Search features, scenarios, steps..." oninput="filterReport()">
      <button class="filter-btn active" onclick="setFilter('all', this)">All (${summary.total})</button>
      <button class="filter-btn" onclick="setFilter('passed', this)">Passed (${summary.passed})</button>
      <button class="filter-btn" onclick="setFilter('failed', this)">Failed (${summary.failed})</button>
    </div>

    <div id="suitesRoot">
      ${featureRowsHtml || '<div style="text-align:center; padding:40px; color:var(--text-muted);">No test execution records found. Run tests from VS Code to populate report.</div>'}
    </div>

    <footer>
      Smart Cucumber-Behave Test Runner & Allure Reporter • Generated automatically from execution runs
    </footer>
  </div>

  <script>
    let currentFilter = 'all';

    function setFilter(filter, btn) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterReport();
    }

    function filterReport() {
      const q = (document.getElementById('reportSearch').value || '').toLowerCase();
      document.querySelectorAll('.scenario-card').forEach(card => {
        const text = card.textContent.toLowerCase();
        const matchesQuery = !q || text.includes(q);
        const matchesFilter = currentFilter === 'all' || card.classList.contains('status-' + currentFilter);
        card.style.display = (matchesQuery && matchesFilter) ? '' : 'none';
      });

      document.querySelectorAll('.feature-suite').forEach(suite => {
        const visibleScenarios = suite.querySelectorAll('.scenario-card:not([style*="display: none"])');
        suite.style.display = visibleScenarios.length > 0 ? '' : 'none';
      });
    }

    function toggleDomCollapse(domId, btn) {
      const el = document.getElementById(domId);
      if (!el) return;
      const isCollapsed = el.classList.contains('collapsed');
      if (isCollapsed) {
        el.classList.remove('collapsed');
        btn.innerHTML = '<span>▼ Collapse Complete DOM</span>';
        btn.classList.add('expanded');
      } else {
        el.classList.add('collapsed');
        btn.innerHTML = '<span>▶ View Complete DOM (Expand)</span>';
        btn.classList.remove('expanded');
      }
    }

    function copyDomCode(domId, btn) {
      const rawEl = document.getElementById('raw-' + domId);
      let text = rawEl ? rawEl.textContent : '';
      if (!text) {
        const codeEl = document.getElementById('code-' + domId);
        text = codeEl ? codeEl.innerText : '';
      }
      const notifySuccess = () => {
        const orig = btn.innerHTML;
        btn.innerHTML = '<span>✓ Copied!</span>';
        setTimeout(() => { btn.innerHTML = orig; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(notifySuccess).catch(() => fallbackCopy(text, btn));
      } else {
        fallbackCopy(text, btn);
      }
    }

    function fallbackCopy(text, btn) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        const orig = btn.innerHTML;
        btn.innerHTML = '<span>✓ Copied!</span>';
        setTimeout(() => { btn.innerHTML = orig; }, 1800);
      } catch (e) {
        /* ignore */
      }
      document.body.removeChild(ta);
    }

    function toggleDomWrap(domId, btn) {
      const preEl = document.getElementById('pre-' + domId);
      if (!preEl) return;
      const isNowrap = preEl.classList.toggle('nowrap');
      const label = btn.querySelector('.wrap-label');
      if (isNowrap) {
        if (label) label.textContent = 'Wrap Lines';
        btn.classList.add('nowrap-active');
      } else {
        if (label) label.textContent = 'Unwrap Lines';
        btn.classList.remove('nowrap-active');
      }
    }
  </script>
</body>
</html>`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}

export const behaveResultsManager = new BehaveResultsManager();
