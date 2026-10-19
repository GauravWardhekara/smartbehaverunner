import { execFileSync } from "child_process";

type ParsedBehaveVersion = {
  major: number;
  minor: number;
  micro: number;
  /** PEP 440–style prerelease; `null` = final release. */
  pre: "dev" | "a" | "b" | "rc" | null;
  preNum: number;
};

/**
 * `--no-capture-stdout` first appeared in behave v1.2.7.dev7 (stable in v1.3.0+).
 * Older releases accept `--no-capture` for stdout only.
 */
const MIN_VERSION_FOR_EXPLICIT_STDOUT_FLAG: ParsedBehaveVersion = {
  major: 1,
  minor: 2,
  micro: 7,
  pre: "dev",
  preNum: 7
};

function preKind(pre: ParsedBehaveVersion["pre"]): number {
  if (pre === null) {
    return 4;
  }
  if (pre === "dev") {
    return 0;
  }
  if (pre === "a") {
    return 1;
  }
  if (pre === "b") {
    return 2;
  }
  return 3;
}

function versionSortKey(v: ParsedBehaveVersion): [number, number, number, number, number] {
  return [v.major, v.minor, v.micro, preKind(v.pre), v.pre === null ? 0 : v.preNum];
}

function compareBehaveVersions(a: ParsedBehaveVersion, b: ParsedBehaveVersion): number {
  const ka = versionSortKey(a);
  const kb = versionSortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) {
      return ka[i] < kb[i] ? -1 : 1;
    }
  }
  return 0;
}

function parseBehaveVersionLine(line: string): ParsedBehaveVersion | undefined {
  const m = line
    .trim()
    .match(/^behave\s+(\d+)\.(\d+)\.(\d+)(?:\.(dev|a|b|rc)(\d+))?$/i);
  if (!m) {
    return undefined;
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const micro = Number(m[3]);
  if (
    !Number.isFinite(major) ||
    !Number.isFinite(minor) ||
    !Number.isFinite(micro)
  ) {
    return undefined;
  }
  const preRaw = m[4]?.toLowerCase();
  const pre: ParsedBehaveVersion["pre"] =
    preRaw === "dev" || preRaw === "a" || preRaw === "b" || preRaw === "rc"
      ? preRaw
      : null;
  const preNum = pre ? Number(m[5]) : 0;
  if (pre !== null && !Number.isFinite(preNum)) {
    return undefined;
  }
  return { major, minor, micro, pre, preNum };
}

function parseBehaveVersionOutput(output: string): ParsedBehaveVersion | undefined {
  for (const line of output.split(/\r?\n/)) {
    const p = parseBehaveVersionLine(line);
    if (p) {
      return p;
    }
  }
  return undefined;
}

const supportsExplicitStdoutFlagCache = new Map<string, boolean>();

function probeBehaveVersionOutput(interpreterPath: string | undefined): string {
  if (interpreterPath != null && interpreterPath.length > 0) {
    return execFileSync(interpreterPath, ["-m", "behave", "--version"], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
      maxBuffer: 256 * 1024
    });
  }
  return execFileSync("behave", ["--version"], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
    maxBuffer: 256 * 1024
  });
}

/**
 * Whether the installed behave accepts `--no-capture-stdout` (vs legacy `--no-capture`).
 * Unknown / unreachable behave → `false` (legacy argv, widest compatibility).
 */
export function behavesSupportsExplicitNoCaptureStdoutFlag(
  interpreterPath: string | undefined
): boolean {
  const cacheKey =
    interpreterPath != null && interpreterPath.length > 0
      ? interpreterPath
      : "\0PATH_BEHAVE";
  const cached = supportsExplicitStdoutFlagCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let output = "";
  try {
    output = probeBehaveVersionOutput(interpreterPath);
  } catch (e: unknown) {
    const x = e as { stdout?: string | Buffer; stderr?: string | Buffer };
    output = `${x.stdout != null ? String(x.stdout) : ""}${x.stderr != null ? String(x.stderr) : ""}`;
    if (!output.trim()) {
      supportsExplicitStdoutFlagCache.set(cacheKey, false);
      return false;
    }
  }

  const parsed = parseBehaveVersionOutput(output);
  const ok =
    parsed !== undefined &&
    compareBehaveVersions(parsed, MIN_VERSION_FOR_EXPLICIT_STDOUT_FLAG) >= 0;
  supportsExplicitStdoutFlagCache.set(cacheKey, ok);
  return ok;
}
