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
      if (entry.name.startsWith(".")) {
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
        if (CONFIG_FILE_EXTENSIONS.has(ext)) {
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

  // 2. If no files detected yet, check common directory names
  if (detected.size === 0) {
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
  }

  // 3. Also check workspace root for caps/config files
  if (detected.size === 0) {
    const rootFiles = scanDirectoryForConfigFiles(workspaceRoot, workspaceRoot, 0, 0);
    for (const f of rootFiles) {
      const lower = f.toLowerCase();
      if (lower.includes("caps") || lower.includes("config") || lower.includes("endpoint")) {
        detected.add(f);
      }
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
