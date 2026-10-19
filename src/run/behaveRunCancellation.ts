import { execSync, type ChildProcess } from "child_process";
import * as vscode from "vscode";
import { appendRunOutput } from "./behaveRunOutput";

/** Log line prefix for Stop / cancel diagnostics (Output → Behave Runner). */
export function logBehaveRunCancel(message: string): void {
  appendRunOutput(
    `[Behave Runner][cancel] ${new Date().toISOString()} ${message}\r\n`
  );
}

/** Merged with caller token so the Live panel Stop button can cancel the active run. */
let activeRunCancellation: vscode.CancellationTokenSource | undefined;

/** shell-spawned Behave root process (see `spawnBehave`). */
let trackedBehaveSpawn: ChildProcess | undefined;

export function registerTrackedBehaveSpawn(proc: ChildProcess): void {
  trackedBehaveSpawn = proc;
}

export function unregisterTrackedBehaveSpawn(proc: ChildProcess): void {
  if (trackedBehaveSpawn === proc) {
    trackedBehaveSpawn = undefined;
  }
}

/**
 * Tear down the tracked Behave run. With `shell: true`, the tracked PID is usually
 * `sh`; killing only that process leaves `python -m behave` alive unless we kill the
 * whole group (Unix `detached` spawn + `kill(-pid)`) or the Windows process tree (`taskkill /T`).
 */
export function forceKillTrackedBehaveSpawn(reason?: string): void {
  const p = trackedBehaveSpawn;
  const why = reason ? ` (${reason})` : "";
  if (!p || p.pid == null) {
    logBehaveRunCancel(`forceKill: no tracked behave process${why}`);
    return;
  }
  const pid = p.pid;

  if (process.platform === "win32") {
    logBehaveRunCancel(`forceKill: Windows taskkill /T /F pid=${pid}${why}`);
    try {
      execSync(`taskkill /PID ${pid} /T /F`, {
        windowsHide: true,
        stdio: "ignore"
      });
      logBehaveRunCancel(`forceKill: taskkill completed pid=${pid}${why}`);
      return;
    } catch (e) {
      logBehaveRunCancel(
        `forceKill: taskkill failed pid=${pid}${why}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  } else {
    logBehaveRunCancel(`forceKill: Unix kill(-pgid) SIGKILL pgid=${pid}${why}`);
    try {
      process.kill(-pid, "SIGKILL");
      logBehaveRunCancel(`forceKill: process.kill(-pgid) returned pgid=${pid}${why}`);
      return;
    } catch (e) {
      logBehaveRunCancel(
        `forceKill: process.kill(-pgid) threw pgid=${pid}${why}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  logBehaveRunCancel(`forceKill: fallback child.kill(SIGKILL) pid=${pid}${why}`);
  try {
    p.kill("SIGKILL");
    logBehaveRunCancel(`forceKill: child.kill(SIGKILL) returned pid=${pid}${why}`);
    return;
  } catch (e) {
    logBehaveRunCancel(
      `forceKill: child.kill(SIGKILL) threw pid=${pid}${why}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  try {
    p.kill();
    logBehaveRunCancel(`forceKill: child.kill() returned pid=${pid}${why}`);
    return;
  } catch (e) {
    logBehaveRunCancel(
      `forceKill: child.kill() threw pid=${pid}${why}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  try {
    process.kill(pid, "SIGKILL");
    logBehaveRunCancel(`forceKill: process.kill(SIGKILL) returned pid=${pid}${why}`);
    return;
  } catch (e) {
    logBehaveRunCancel(
      `forceKill: process.kill(SIGKILL) threw pid=${pid}${why}: ${e instanceof Error ? e.message : String(e)}`
    );
    try {
      process.kill(pid);
      logBehaveRunCancel(`forceKill: process.kill() returned pid=${pid}${why}`);
    } catch (e2) {
      logBehaveRunCancel(
        `forceKill: process.kill() threw pid=${pid}${why}: ${e2 instanceof Error ? e2.message : String(e2)}`
      );
    }
  }
}

export function takeOverActiveRunCancellation(): vscode.CancellationTokenSource {
  activeRunCancellation?.cancel();
  const cts = new vscode.CancellationTokenSource();
  activeRunCancellation = cts;
  return cts;
}

export function releaseActiveRunCancellation(
  cts: vscode.CancellationTokenSource
): void {
  if (activeRunCancellation === cts) {
    activeRunCancellation = undefined;
  }
  cts.dispose();
}

export function cancelActiveBehaveRun(): void {
  const hadSpawn = trackedBehaveSpawn != null && trackedBehaveSpawn.pid != null;
  const pid = hadSpawn ? trackedBehaveSpawn!.pid : undefined;
  const hadSource = activeRunCancellation != undefined;
  logBehaveRunCancel(
    `cancelActiveBehaveRun: entry trackedPid=${pid ?? "none"} hadCancellationSource=${hadSource}`
  );
  forceKillTrackedBehaveSpawn("cancelActiveBehaveRun");
  if (!hadSource) {
    logBehaveRunCancel(
      "cancelActiveBehaveRun: no CancellationTokenSource (nothing to cancel — run may have ended or not started)"
    );
    return;
  }
  logBehaveRunCancel("cancelActiveBehaveRun: calling cancellationSource.cancel() …");
  activeRunCancellation!.cancel();
  logBehaveRunCancel(
    "cancelActiveBehaveRun: cancellationSource.cancel() returned (listeners ran synchronously)"
  );
}
