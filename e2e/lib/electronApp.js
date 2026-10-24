const fs = require("fs");
const path = require("path");
const { _electron: electron } = require("playwright");
const { sameRealPath } = require("./files");

const BASE_SETTINGS = {
  settingsVersion: 1,
  firstLaunch: false,
  hideSupportModal: true,
  checkUpdatesOnStartup: false,
  denoReminderDismissed: true,
  // Keeps OS notifications from popping up while the suite runs.
  notifications: false,
};

const LAUNCH_TIMEOUT_MS = 60_000;

// Background mode asks the app to keep its windows from taking focus, so local
// runs do not pop over the maintainer's work. The app reads
// ROSI_LTS_E2E_BACKGROUND; the rules are documented in FAILURE-MODES.md.
function resolveBackgroundMode(env = process.env) {
  const explicit = env.ROSI_LTS_E2E_BACKGROUND;
  if (explicit === "1" || explicit === "0") {
    return {
      enabled: explicit === "1",
      value: explicit,
      reason: `explicit ROSI_LTS_E2E_BACKGROUND=${explicit}`,
    };
  }
  const off = (reason) => ({ enabled: false, value: "0", reason });
  if (process.platform !== "darwin") return off("not macOS");
  if (env.ROSI_LTS_E2E_FOREGROUND === "1") {
    return off("ROSI_LTS_E2E_FOREGROUND=1");
  }
  const ci = env.CI;
  if (ci !== undefined && ci !== "" && ci !== "false" && ci !== "0") {
    return off(`CI=${ci}`);
  }
  return { enabled: true, value: "1", reason: "macOS, not CI" };
}

// ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node, so the
// app would never start. Some shells (including IDE-hosted ones) set it.
function appEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.ROSI_LTS_E2E_BACKGROUND = resolveBackgroundMode().value;
  return env;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Points the app's download folder at `dir` without showing a native dialog.
async function stubDownloadDialog(electronApp, dir) {
  await electronApp.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, dir);
}

async function waitForMainWindow(electronApp, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const win of electronApp.windows()) {
      let pathname = "";
      try {
        pathname = new URL(win.url()).pathname;
      } catch {
        continue;
      }
      if (pathname.endsWith("/index.html")) {
        await win.waitForLoadState("domcontentloaded");
        await win.waitForSelector("#downloadBtn", { state: "attached" });
        return win;
      }
    }
    await sleep(100);
  }
  throw new Error("Main window (index.html) did not appear within 30 s.");
}

// Records every progress and completion message from the main process so
// specs can wait on them without parsing the console DOM.
async function installEventTap(page) {
  await page.evaluate(() => {
    window.__rosiE2E = { progress: [], complete: [] };
    window.api.onProgress((message) => window.__rosiE2E.progress.push(message));
    window.api.onComplete((message) => window.__rosiE2E.complete.push(message));
  });
}

async function completionCount(page) {
  return page.evaluate(() => window.__rosiE2E.complete.length);
}

// Waits for a completion message newer than `previousCount` and returns it.
async function waitForCompletion(page, previousCount, timeoutMs = 60_000) {
  await page.waitForFunction(
    (count) => window.__rosiE2E.complete.length > count,
    previousCount,
    { timeout: timeoutMs, polling: 200 },
  );
  return page.evaluate(() => window.__rosiE2E.complete.at(-1));
}

// Waits for the UI to finish a download attempt: either a completion message
// arrives, or the renderer shows a modal (for example a validation error from
// the main process). Returns { kind: "complete" | "modal" | "timeout", message }.
async function waitForUiOutcome(page, previousCount, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const outcome = await page.evaluate((count) => {
      if (window.__rosiE2E.complete.length > count) {
        return { kind: "complete", message: window.__rosiE2E.complete.at(-1) };
      }
      const modal = document.getElementById("app-modal");
      if (modal && modal.classList.contains("active")) {
        return {
          kind: "modal",
          message: [
            document.getElementById("modal-title").textContent,
            document.getElementById("modal-message").textContent,
          ].join(": "),
        };
      }
      return null;
    }, previousCount);
    if (outcome) return outcome;
    await sleep(200);
  }
  return { kind: "timeout", message: "no completion and no modal" };
}

// Starts a download through the same IPC the UI uses, bypassing the renderer
// form. Used where the UI path is itself broken (see F10).
async function startDownloadIpc(page, options) {
  return page.evaluate((opts) => window.api.downloadVideo(opts), options);
}

// Returns the newest main-process progress line containing `text`, or null.
async function findProgressLine(page, text) {
  return page.evaluate((needle) => {
    const lines = window.__rosiE2E.progress.filter((line) =>
      line.includes(needle),
    );
    return lines.length ? lines.at(-1) : null;
  }, text);
}

async function waitForProgress(page, pattern, timeoutMs = 60_000) {
  await page.waitForFunction(
    (source) => {
      const re = new RegExp(source);
      return window.__rosiE2E.progress.some((line) => re.test(line));
    },
    pattern.source,
    { timeout: timeoutMs, polling: 200 },
  );
}

// Launches the real app with an isolated userData dir and a stubbed
// download-folder picker. Returns the session used by specs.
async function launchApp({ repoRoot, userDataDir, downloadDir, seed }) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });
  const settingsPath = path.join(userDataDir, "settings.json");
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({ ...BASE_SETTINGS, ...(seed || {}) }, null, 2),
  );

  const app = await electron.launch({
    args: [".", `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env: appEnv(),
    timeout: LAUNCH_TIMEOUT_MS,
  });

  const session = {
    app,
    page: null,
    userDataDir,
    downloadDir,
    closed: false,
    userDataHonored: false,
    backgroundMode: resolveBackgroundMode(),
  };

  try {
    const reportedUserData = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath("userData"),
    );
    session.userDataHonored = sameRealPath(reportedUserData, userDataDir);
    if (!session.userDataHonored) {
      throw new Error(
        `Electron reported userData=${reportedUserData}, expected ${userDataDir}. --user-data-dir was not honored.`,
      );
    }

    await stubDownloadDialog(app, downloadDir);
    session.page = await waitForMainWindow(app);
    await installEventTap(session.page);
  } catch (error) {
    await closeApp(session);
    throw error;
  }
  return session;
}

async function closeApp(session) {
  if (!session || session.closed) return;
  session.closed = true;
  const proc = session.app.process();
  try {
    await withTimeout(session.app.close(), 15_000, "app.close() timed out");
  } catch {
    try {
      proc.kill("SIGKILL");
    } catch {
      // already exited
    }
  }
}

module.exports = {
  BASE_SETTINGS,
  resolveBackgroundMode,
  sleep,
  withTimeout,
  launchApp,
  closeApp,
  completionCount,
  waitForCompletion,
  waitForUiOutcome,
  waitForProgress,
  startDownloadIpc,
  findProgressLine,
};
