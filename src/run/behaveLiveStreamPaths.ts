import * as path from "path";

function normalizeFsPath(p: string): string {
  return path.normalize(p).replace(/\\/g, "/").toLowerCase();
}

function pathsEqual(a: string, b: string): boolean {
  return normalizeFsPath(a) === normalizeFsPath(b);
}

function resolveToAbsoluteFsPath(filePath: string, cwd: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return trimmed;
  }
  const norm = path.normalize(trimmed.replace(/\\/g, path.sep));
  if (path.isAbsolute(norm)) {
    return norm;
  }
  return path.normalize(path.resolve(cwd, norm));
}

/** Compare paths where either side may be relative (Behave locations) vs absolute (VS Code). */
export function pathsEqualFs(a: string, b: string, cwd: string): boolean {
  try {
    return (
      normalizeFsPath(resolveToAbsoluteFsPath(a, cwd)) ===
      normalizeFsPath(resolveToAbsoluteFsPath(b, cwd))
    );
  } catch {
    return false;
  }
}

export function normalizeScenarioName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function stripOutlineSuffix(name: string): string {
  const idx = name.indexOf(" -- @");
  if (idx >= 0) {
    return name.slice(0, idx).trim();
  }
  return name.trim();
}

/** Behave `location` strings use 1-based line numbers (e.g. `features/a.feature:3`). */
export function parseBehaveLocation(
  loc: string | undefined
): { filePath: string; line1Based: number } | null {
  if (!loc || typeof loc !== "string") {
    return null;
  }
  const m = loc.trim().match(/^(.+):(\d+)$/);
  if (!m) {
    return null;
  }
  const line = parseInt(m[2], 10);
  if (!Number.isFinite(line)) {
    return null;
  }
  return { filePath: path.normalize(m[1]), line1Based: line };
}

export { pathsEqual };
