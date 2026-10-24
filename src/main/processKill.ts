import { execFile } from "child_process";
import log from "electron-log/main";
import type { ChildProcess } from "child_process";
import { isWindows } from "./platform";

const FORCE_KILL_DELAY_MS = 5000;

function taskkillTree(pid: number) {
  execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => {});
}

function signalTree(proc: ChildProcess, signal: NodeJS.Signals) {
  const pid = proc.pid;
  if (!pid) {
    proc.kill(signal);
    return;
  }
  try {
    // Processes are spawned detached, so the PID is also the process-group ID.
    process.kill(-pid, signal);
  } catch {
    proc.kill(signal);
  }
}

export function killChildProcess(proc: ChildProcess | null, label: string) {
  if (!proc || proc.killed) return;
  try {
    if (isWindows) {
      // proc.kill() only reaches the top PID on Windows, so use the tree kill directly.
      if (proc.pid) {
        taskkillTree(proc.pid);
      } else {
        proc.kill();
      }
      return;
    }
    signalTree(proc, "SIGTERM");
    // Not cleared on exit: the group can still hold children after its leader exits.
    setTimeout(() => {
      try {
        signalTree(proc, "SIGKILL");
      } catch {}
    }, FORCE_KILL_DELAY_MS).unref();
  } catch (error) {
    log.error(`Error killing ${label} process:`, error);
  }
}
