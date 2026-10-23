import { escapeBehaveNameSelect } from "../core";
import * as cp from "child_process";
import * as path from "path";
import type { BehaveJob } from "./behaveJobTypes";
import { getBehaveExtraArgsForResource } from "./behavePythonDebug";
import { behavesSupportsExplicitNoCaptureStdoutFlag } from "./behaveVersion";

export function liveFormatterBundlePath(extensionPath: string): string {
  return path.join(extensionPath, "media", "python");
}

/** Quote one argv token for `cmd.exe` (spawn `{ shell: true }` on Windows). */
function cmdQuoteArg(arg: string): string {
  if (!/[ \t"&|<>^]/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/"/g, '""')}"`;
}

/** Quote one argv token for POSIX `sh -c` style strings. */
function shQuoteArg(arg: string): string {
  if (/^[\w@%+=:,./-]+$/i.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function quoteShellArg(arg: string): string {
  return process.platform === "win32" ? cmdQuoteArg(arg) : shQuoteArg(arg);
}

/**
 * Run Behave via shell with `2>&1` so stderr is byte-interleaved with stdout
 * (NDJSON formatter). Node otherwise reads two pipes with arbitrary ordering.
 */
export function spawnBehave(
  job: BehaveJob,
  cwd: string,
  interpreterPath: string | undefined,
  opts: {
    liveFormatterPythonRoot: string;
    capsFile?: string;
    extraCliArgs?: string[];
  }
): cp.ChildProcessWithoutNullStreams {
  const stdoutCaptureFlag = behavesSupportsExplicitNoCaptureStdoutFlag(
    interpreterPath
  )
    ? "--no-capture-stdout"
    : "--no-capture";
  const behaveArgs: string[] = [
    stdoutCaptureFlag,
    "--no-capture-stderr",
    "--no-logcapture",
    "--no-summary",
    "-f",
    "behave_runner_live:BehaveRunnerLiveFormatter",
    ...getBehaveExtraArgsForResource(job.fsPath, opts.capsFile),
    ...(opts.extraCliArgs ?? [])
  ];
  if (job.kind === "feature") {
    behaveArgs.push(job.fsPath);
  } else {
    behaveArgs.push("-n", escapeBehaveNameSelect(job.scenarioName), job.fsPath);
  }
  const env = { ...(process.env as NodeJS.ProcessEnv) };
  env.PYTHONUNBUFFERED = "1";
  const root = opts.liveFormatterPythonRoot;
  const sep = path.delimiter;
  const prev = env.PYTHONPATH ?? "";
  env.PYTHONPATH = prev ? `${root}${sep}${prev}` : root;

  const quotedBehave = behaveArgs.map(quoteShellArg);
  const command =
    interpreterPath != null && interpreterPath.length > 0
      ? `${quoteShellArg(interpreterPath)} -u -m behave ${quotedBehave.join(" ")} 2>&1`
      : `behave ${quotedBehave.join(" ")} 2>&1`;

  return cp.spawn(command, {
    cwd,
    env,
    shell: true,
    windowsHide: true,
    /**
     * Unix: new session + process group so `kill(-pid)` tears down `sh -c … → python`
     * together. Without this, SIGKILL only hits the shell and Behave keeps running.
     */
    ...(process.platform !== "win32" ? { detached: true } : {})
  }) as cp.ChildProcessWithoutNullStreams;
}
