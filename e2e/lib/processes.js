const { execFileSync } = require("child_process");

function listProcesses() {
  const output = execFileSync("ps", ["-axww", "-o", "pid=,command="], {
    encoding: "utf8",
  });
  const rows = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), command: match[2] });
  }
  return rows;
}

// Returns processes whose command line contains any of `tokens`.
function findProcessesWithTokens(tokens) {
  return listProcesses().filter(
    (proc) =>
      proc.pid !== process.pid && tokens.some((token) => proc.command.includes(token)),
  );
}

function killProcessesWithTokens(tokens) {
  for (const proc of findProcessesWithTokens(tokens)) {
    try {
      process.kill(proc.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

module.exports = { listProcesses, findProcessesWithTokens, killProcessesWithTokens };
