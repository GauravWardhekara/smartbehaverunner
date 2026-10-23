import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { settings } from "../settings";
import { LOG } from "../log";

/** Common file extensions recognized as configuration files. */
const CONFIG_FILE_EXTENSIONS = new Set([
  ".json",
  ".properties",
  ".yaml",
  ".yml",
  ".conf",
  ".ini",
  ".toml",
  ".env",
  ".cfg"
]);

/**
 * Normalizes file path to use forward slashes (cross-platform consistency).
 */
export function normalizePathSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Recursively or flatly finds candidate config files in target directory.
 */
function scanDirectoryForConfigFiles(
  dirPath: string,
  baseDir: string,
  maxDepth = 3,
  currentDepth = 0
): string[] {
  const results: string[] = [];
  if (currentDepth > maxDepth || !fs.existsSync(dirPath)) {
    return results;
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".behaverc") {
        continue;
      }
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === "__pycache__"
        ) {
          continue;
        }
        results.push(
          ...scanDirectoryForConfigFiles(
            fullPath,
            baseDir,
            maxDepth,
            currentDepth + 1
          )
        );
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (entry.name === ".behaverc" || CONFIG_FILE_EXTENSIONS.has(ext)) {
          const rel = normalizePathSlashes(path.relative(baseDir, fullPath));
          results.push(rel);
        }
      }
    }
  } catch (err) {
    LOG.warn(`Could not read directory ${dirPath}:`, err);
  }

  return results;
}

/**
 * Detects all configuration files for a given workspace root.
 *
 * 1. Checks configured directory from settings (e.g. `behave.configDirectory`).
 * 2. If configured folder does not exist or has no config files, checks common folders
 *    (configs, config, caps, capabilities) and workspace root.
 */
export function detectConfigFiles(
  workspaceRoot: string,
  configDirSetting?: string
): string[] {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
    return [];
  }

  const detected = new Set<string>();
  const explicitDir = configDirSetting?.trim() || "";

  // 1. If an explicit configDirectory is specified, search inside it
  if (explicitDir.length > 0) {
    const targetDir = path.isAbsolute(explicitDir)
      ? explicitDir
      : path.resolve(workspaceRoot, explicitDir);
    if (fs.existsSync(targetDir)) {
      const files = scanDirectoryForConfigFiles(targetDir, workspaceRoot);
      for (const f of files) {
        detected.add(f);
      }
    }
  }

  // 2. Also check common directory names (configs, config, caps, capabilities)
  const candidateDirs = ["configs", "config", "caps", "capabilities"];
  for (const candidate of candidateDirs) {
    const candPath = path.resolve(workspaceRoot, candidate);
    if (fs.existsSync(candPath)) {
      const files = scanDirectoryForConfigFiles(candPath, workspaceRoot);
      for (const f of files) {
        detected.add(f);
      }
    }
  }

  // 3. Scan one level deep for common project subfolders (e.g. example/configs, test/config, tests/configs)
  try {
    const rootEntries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    for (const ent of rootEntries) {
      if (ent.isDirectory() && !ent.name.startsWith(".") && ent.name !== "node_modules" && ent.name !== "out" && ent.name !== "dist") {
        for (const candidate of candidateDirs) {
          const subCandPath = path.join(workspaceRoot, ent.name, candidate);
          if (fs.existsSync(subCandPath)) {
            const files = scanDirectoryForConfigFiles(subCandPath, workspaceRoot);
            for (const f of files) {
              detected.add(f);
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 4. Also check workspace root for caps/config files
  const rootFiles = scanDirectoryForConfigFiles(workspaceRoot, workspaceRoot, 0, 0);
  for (const f of rootFiles) {
    const lower = f.toLowerCase();
    if (lower.includes("caps") || lower.includes("config") || lower.includes("endpoint")) {
      if (
        lower === "package.json" ||
        lower === "package-lock.json" ||
        lower === "tsconfig.json" ||
        lower === "language-configuration.json" ||
        lower === "dprint.json" ||
        lower === "eslint.config.mjs"
      ) {
        continue;
      }
      detected.add(f);
    }
  }

  return Array.from(detected).sort();
}

/**
 * Injects or replaces Behave `-D caps_file=<relativePath>` in extraArgs list.
 */
export function applyCapsFileArg(extraArgs: string[], capsFile: string): string[] {
  const result: string[] = [];
  const normalizedCapsFile = normalizePathSlashes(capsFile);

  for (let i = 0; i < extraArgs.length; i++) {
    const arg = extraArgs[i];
    if (arg === "-D" || arg === "--define") {
      const next = extraArgs[i + 1];
      if (
        next &&
        (next.startsWith("caps_file=") ||
          next.startsWith("'caps_file=") ||
          next.startsWith('"caps_file='))
      ) {
        i++; // Skip the next value argument as well
        continue;
      }
      result.push(arg);
    } else if (
      arg.startsWith("-Dcaps_file=") ||
      arg.startsWith("--define=caps_file=") ||
      arg.startsWith("-D caps_file=") ||
      arg.startsWith("--define caps_file=")
    ) {
      // Skip inline caps_file definition
      continue;
    } else {
      result.push(arg);
    }
  }

  result.push("-D", `caps_file=${normalizedCapsFile}`);
  return result;
}

/**
 * Resolves the configuration file to pass for `caps_file`.
 *
 * Rules:
 * 1. If `behave.defaultConfigFile` is configured and exists, returns its relative path directly.
 * 2. If not configured, detects all config files in the project.
 * 3. If no config files detected, returns undefined (run proceeds normally).
 * 4. If config files detected, displays a QuickPick for the user to select one.
 * 5. If user cancels the QuickPick (Esc), returns null (indicating cancellation).
 */
export async function promptOrResolveCapsFile(
  resourcePath: string
): Promise<string | undefined | null> {
  const resourceUri = vscode.Uri.file(resourcePath);
  const folder = vscode.workspace.getWorkspaceFolder(resourceUri);
  const workspaceRoot = folder ? folder.uri.fsPath : path.dirname(resourcePath);

  // 1. Check if default configuration file is configured
  const defaultFile = settings.defaultConfigFile(resourceUri)?.trim() ?? "";
  if (defaultFile.length > 0) {
    const configDir = settings.configDirectory(resourceUri)?.trim() || "configs";
    // Check direct relative to workspaceRoot
    const candidate1 = path.resolve(workspaceRoot, defaultFile);
    if (fs.existsSync(candidate1)) {
      return normalizePathSlashes(path.relative(workspaceRoot, candidate1));
    }
    // Check relative to configDirectory
    const candidate2 = path.resolve(workspaceRoot, configDir, defaultFile);
    if (fs.existsSync(candidate2)) {
      return normalizePathSlashes(path.relative(workspaceRoot, candidate2));
    }
    LOG.warn(
      `Smart Behave: Configured defaultConfigFile "${defaultFile}" not found in workspace; prompting user instead.`
    );
  }

  // 2. Default configuration file is NOT configured -> detect all configuration files
  const configDirSetting = settings.configDirectory(resourceUri)?.trim() || "configs";
  const detectedFiles = detectConfigFiles(workspaceRoot, configDirSetting);

  if (detectedFiles.length === 0) {
    // No config files in project -> proceed without caps_file
    return undefined;
  }

  // 3. Ask user to choose a configuration file
  interface ConfigFileQuickPickItem extends vscode.QuickPickItem {
    relativePath: string;
  }

  const items: ConfigFileQuickPickItem[] = detectedFiles.map((f) => ({
    label: `$(gear) ${path.basename(f)}`,
    description: f,
    detail: `Relative path: ${f}`,
    relativePath: f
  }));

  const chosen = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a configuration file for Behave 'caps_file' argument",
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!chosen) {
    // User pressed ESC / cancelled
    return null;
  }

  return normalizePathSlashes(chosen.relativePath);
}

export interface BehaveParsedConfig {
  defaultTags?: string;
  tags?: string;
  dryRun?: boolean;
  wip?: boolean;
  stop?: boolean;
  showSkipped?: boolean;
  showTimings?: boolean;
  format?: string;
  outfiles?: string;
  junit?: boolean;
  junitDirectory?: string;
  loggingLevel?: string;
  stdoutCapture?: boolean;
  stderrCapture?: boolean;
  userdata: Record<string, string>;
}

/**
 * Parses INI-style Behave configuration files (`behave.ini`, `.behaverc`, `setup.cfg`, `tox.ini`).
 * Extracts `[behave]` and `[behave.userdata]` settings as documented in official Behave documentation.
 */
export function parseBehaveConfigFile(filePath: string): BehaveParsedConfig | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    let currentSection = "";
    const config: BehaveParsedConfig = {
      userdata: {},
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || line.startsWith(";")) {
        continue;
      }
      const sectionMatch = line.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim().toLowerCase();
        continue;
      }

      const eqIdx = line.indexOf("=");
      const colIdx = line.indexOf(":");
      let delimiterIdx = -1;
      if (eqIdx !== -1 && colIdx !== -1) {
        delimiterIdx = Math.min(eqIdx, colIdx);
      } else if (eqIdx !== -1) {
        delimiterIdx = eqIdx;
      } else {
        delimiterIdx = colIdx;
      }

      if (delimiterIdx === -1) {
        continue;
      }

      const key = line.slice(0, delimiterIdx).trim().toLowerCase();
      const val = line.slice(delimiterIdx + 1).trim();

      const parseBool = (v: string): boolean => {
        const l = v.toLowerCase();
        return l === "true" || l === "yes" || l === "1" || l === "on";
      };

      if (currentSection === "behave") {
        switch (key) {
          case "default_tags":
            config.defaultTags = val;
            break;
          case "tags":
            config.tags = val;
            break;
          case "dry_run":
            config.dryRun = parseBool(val);
            break;
          case "wip":
            config.wip = parseBool(val);
            break;
          case "stop":
            config.stop = parseBool(val);
            break;
          case "show_skipped":
            config.showSkipped = parseBool(val);
            break;
          case "show_timings":
            config.showTimings = parseBool(val);
            break;
          case "format":
            config.format = val;
            break;
          case "outfiles":
            config.outfiles = val;
            break;
          case "junit":
            config.junit = parseBool(val);
            break;
          case "junit_directory":
            config.junitDirectory = val;
            break;
          case "logging_level":
            config.loggingLevel = val.toUpperCase();
            break;
          case "stdout_capture":
            config.stdoutCapture = parseBool(val);
            break;
          case "stderr_capture":
            config.stderrCapture = parseBool(val);
            break;
        }
      } else if (currentSection === "behave.userdata") {
        config.userdata[key] = val;
      }
    }

    return config;
  } catch (err) {
    LOG.warn(`Failed to parse Behave config file ${filePath}:`, err);
    return null;
  }
}

/**
 * Automatically locates the active Behave configuration file in the workspace root.
 * Follows Behave's lookup precedence: `behave.ini`, `.behaverc`, `setup.cfg`, `tox.ini`.
 */
export function detectBehaveProjectConfig(
  workspaceRoot: string
): { filePath: string; config: BehaveParsedConfig } | null {
  const candidateNames = ["behave.ini", ".behaverc", "setup.cfg", "tox.ini"];
  for (const name of candidateNames) {
    const full = path.resolve(workspaceRoot, name);
    if (fs.existsSync(full)) {
      const cfg = parseBehaveConfigFile(full);
      if (cfg) {
        return { filePath: full, config: cfg };
      }
    }
  }
  return null;
}
