import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export const DEFAULT_SMART_BEHAVE_ARGS =
  "-D property_file=configs/config.properties -D endpoint_file=endpoints.json -D caps_file=ios_caps_v5.json -D log_level=DEBUG";

/**
 * Tokenize command-line argument string into individual arguments,
 * respecting quoted substrings.
 */
export function splitCommandLineArgs(argsStr: string): string[] {
  const result: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(argsStr)) !== null) {
    if (match[1] !== undefined) {
      result.push(match[1]);
    } else if (match[2] !== undefined) {
      result.push(match[2]);
    } else {
      result.push(match[0]);
    }
  }
  return result;
}

/**
 * Reads default Behave CLI args from `.vscode/launch.json` inputs (e.g. smartBehaveArgs).
 */
export function getLaunchJsonSmartBehaveArgs(workspaceRoot: string): string[] {
  try {
    const launchPath = path.join(workspaceRoot, ".vscode", "launch.json");
    if (!fs.existsSync(launchPath)) {
      return [];
    }
    const raw = fs.readFileSync(launchPath, "utf-8");
    const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed?.inputs)) {
      const input = parsed.inputs.find(
        (inp: Record<string, unknown>) => inp?.id === "smartBehaveArgs"
      );
      if (input && typeof input.default === "string" && input.default.trim().length > 0) {
        return splitCommandLineArgs(input.default.trim());
      }
    }
  } catch {
    /* ignore json parsing issues */
  }
  return [];
}

/**
 * Ensures `.vscode/launch.json` exists in workspaceRoot with smartBehaveArgs input configured.
 */
export async function ensureLaunchJsonWithSmartBehaveArgs(workspaceRoot: string): Promise<void> {
  try {
    const dotVscode = path.join(workspaceRoot, ".vscode");
    const launchPath = path.join(dotVscode, "launch.json");

    if (!fs.existsSync(launchPath)) {
      await fs.promises.mkdir(dotVscode, { recursive: true });
      const content = {
        version: "0.2.0",
        configurations: [
          {
            name: "Smart Behave: Run / Debug Current Feature",
            type: "python",
            request: "launch",
            module: "behave",
            args: ["${input:smartBehaveArgs}", "${file}"],
            console: "integratedTerminal",
            justMyCode: true
          },
          {
            name: "Smart Behave: Run / Debug All Features",
            type: "python",
            request: "launch",
            module: "behave",
            args: ["${input:smartBehaveArgs}", "features"],
            console: "integratedTerminal",
            justMyCode: true
          }
        ],
        inputs: [
          {
            id: "smartBehaveArgs",
            type: "promptString",
            description: "Enter custom Behave arguments",
            default: DEFAULT_SMART_BEHAVE_ARGS
          }
        ]
      };
      await fs.promises.writeFile(launchPath, JSON.stringify(content, null, 2), "utf-8");
      return;
    }

    const raw = await fs.promises.readFile(launchPath, "utf-8");
    const stripped = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const parsed = JSON.parse(stripped);
    if (!parsed || typeof parsed !== "object") return;

    let modified = false;
    if (!Array.isArray(parsed.inputs)) {
      parsed.inputs = [];
      modified = true;
    }
    const hasSmartInput = parsed.inputs.some(
      (inp: Record<string, unknown>) => inp?.id === "smartBehaveArgs"
    );
    if (!hasSmartInput) {
      parsed.inputs.push({
        id: "smartBehaveArgs",
        type: "promptString",
        description: "Enter custom Behave arguments",
        default: DEFAULT_SMART_BEHAVE_ARGS
      });
      modified = true;
    }

    if (modified) {
      await fs.promises.writeFile(launchPath, JSON.stringify(parsed, null, 2), "utf-8");
    }
  } catch {
    /* ignore write errors */
  }
}
