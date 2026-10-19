import { PVSC_EXTENSION_ID, PythonExtension, Resource } from "@vscode/python-extension";
import { existsSync } from "fs";
import { isAbsolute, join } from "path";
import { extensions, Uri, workspace } from "vscode";
import { LOG } from "../log";
import { err, ok, Result } from "./expected";

export enum Error
{
    ExtensionMissing,
    ExtensionInactive,
}

export function getExtension()
{
    const extension = extensions.getExtension<PythonExtension>(PVSC_EXTENSION_ID);

    if (!extension)
    {
        return err(Error.ExtensionMissing);
    }

    if (!extension.isActive)
    {
        return err(Error.ExtensionInactive);
    }

    return ok(extension);
}

export function resolveFallbackPython(workspaceUri?: Uri): string | undefined
{
    const folder = workspaceUri ? workspace.getWorkspaceFolder(workspaceUri) : workspace.workspaceFolders?.[0];
    const root = folder?.uri.fsPath;

    // Check configuration
    const config = workspace.getConfiguration("python", workspaceUri);
    const configured = config.get<string>("defaultInterpreterPath") || config.get<string>("pythonPath");
    if (configured && configured.trim().length > 0)
    {
        const trimmed = configured.trim();
        if (isAbsolute(trimmed) && existsSync(trimmed))
        {
            return trimmed;
        }
        if (root)
        {
            const resolved = join(root, trimmed);
            if (existsSync(resolved))
            {
                return resolved;
            }
        }
    }

    // Check common venv folders in workspace
    if (root)
    {
        const candidates = [
            process.platform === "win32" ? join(root, ".venv", "Scripts", "python.exe") : join(root, ".venv", "bin", "python"),
            process.platform === "win32" ? join(root, "venv", "Scripts", "python.exe") : join(root, "venv", "bin", "python"),
            process.platform === "win32" ? join(root, "env", "Scripts", "python.exe") : join(root, "env", "bin", "python"),
        ];

        for (const candidate of candidates)
        {
            if (existsSync(candidate))
            {
                return candidate;
            }
        }
    }

    return process.platform === "win32" ? "python.exe" : "python";
}

export function getExecutable(resource: Resource): Result<string, Error>
{
    const ext = getExtension();
    if (ext.isOk())
    {
        const activePath = ext.value.exports.environments.getActiveEnvironmentPath(resource)?.path;
        if (activePath && activePath.trim().length > 0)
        {
            return ok(activePath);
        }
    }

    const fallback = resolveFallbackPython(resource && "uri" in resource ? resource.uri : undefined);
    if (fallback)
    {
        return ok(fallback);
    }

    return err(Error.ExtensionInactive);
}

export type InterpreterInfo = {
  path: string | undefined;
  source: "python.defaultInterpreterPath" | "python.pythonPath" | "python.getActiveEnvironmentPath" | "none";
};

export function getPythonInterpreterPath(
  resourcePath: string,
  _workspaceRoot?: string
): InterpreterInfo {
  const uri = Uri.file(resourcePath);
  const ext = getExtension();
  if (ext.isOk()) {
    const active = ext.value.exports.environments.getActiveEnvironmentPath(uri)?.path;
    if (active && active.trim().length > 0) {
      return { path: active, source: "python.getActiveEnvironmentPath" };
    }
  }

  const fallback = resolveFallbackPython(uri);
  if (fallback) {
    return { path: fallback, source: "python.defaultInterpreterPath" };
  }

  return { path: undefined, source: "none" };
}
