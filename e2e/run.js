// E2E runner for ROSI-LTS. Drives the real Electron app with Playwright.
// Usage: npm run test:e2e (compiles first, then runs this file).
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { requireTools, generateFixtures } = require("./lib/ffmpeg");
const { startFixtureServer } = require("./lib/fixtureServer");
const { sha256File, findFiles } = require("./lib/files");
const {
  launchApp,
  resolveBackgroundMode,
  closeApp,
  withTimeout,
  completionCount,
  waitForCompletion,
  waitForProgress,
} = require("./lib/electronApp");
const { killProcessesWithTokens } = require("./lib/processes");
const { writeReport } = require("./lib/report");

const REPO_ROOT = path.resolve(__dirname, "..");
const ARTIFACTS_DIR = path.join(__dirname, "artifacts");
const SPECS_DIR = path.join(__dirname, "specs");
const SPEC_TIMEOUT_MS = 90_000;

function readPackageVersion(name) {
  const file = path.join(REPO_ROOT, "node_modules", name, "package.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).version;
}

function ytdlpBinaryPath() {
  const names = {
    darwin: "yt-dlp_macos",
    linux: "yt-dlp_linux",
    win32: "yt-dlp.exe",
  };
  return path.join(
    REPO_ROOT,
    "assets",
    names[process.platform] || "yt-dlp_linux",
  );
}

// yt-dlp's bundled binary is only made executable by the app at startup.
// Copy it into the run's temp dir to query the version without touching the repo.
function ytdlpVersion(runRoot) {
  const copy = path.join(runRoot, "yt-dlp-version-probe");
  fs.copyFileSync(ytdlpBinaryPath(), copy);
  fs.chmodSync(copy, 0o755);
  return execFileSync(copy, ["--version"], { encoding: "utf8" }).trim();
}

function macOsVersion() {
  if (process.platform !== "darwin") return "";
  return execFileSync("sw_vers", ["-productVersion"], {
    encoding: "utf8",
  }).trim();
}

function collectEnvironment(runRoot, tools) {
  const background = resolveBackgroundMode();
  return {
    backgroundMode: background.enabled ? "on" : "off",
    backgroundReason: background.reason,
    os: `${process.platform} ${os.release()}${macOsVersion() ? ` (macOS ${macOsVersion()})` : ""}`,
    arch: process.arch,
    nodeVersion: process.version,
    electronVersion: readPackageVersion("electron"),
    playwrightVersion: readPackageVersion("playwright"),
    ytdlpBinary: path.relative(REPO_ROOT, ytdlpBinaryPath()),
    ytdlpVersion: ytdlpVersion(runRoot),
    ffmpeg: tools.ffmpeg,
    ffprobe: tools.ffprobe,
  };
}

function loadSpecs() {
  const specs = [];
  for (const file of fs
    .readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith(".js"))
    .sort()) {
    const spec = require(path.join(SPECS_DIR, file));
    if (!spec.id || !spec.title || typeof spec.run !== "function") {
      throw new Error(
        `Spec ${file} must export { id, title, failureModes, run }.`,
      );
    }
    specs.push(spec);
  }
  return specs;
}

function createContext(spec, shared) {
  const { repoRoot, specRoot, server, fixtures } = shared;
  const makeToken = (label) =>
    `rosi-e2e-${label}-${crypto.randomBytes(6).toString("hex")}`;
  let launchCount = 0;

  const ctx = {
    id: spec.id,
    root: specRoot,
    checks: [],
    notes: [],
    files: [],
    tokens: [],
    sessions: [],
    currentPage: null,
    token(label) {
      const value = makeToken(label);
      ctx.tokens.push(value);
      shared.allTokens.push(value);
      return value;
    },
    url(name) {
      return `${server.baseUrl}/media/${encodeURIComponent(name)}`;
    },
    throttledUrl(tokenValue, name) {
      return `${server.baseUrl}/throttled/${tokenValue}/${encodeURIComponent(name)}`;
    },
    fixtureSha(name) {
      return fixtures.sha256[name];
    },
    dir(name) {
      const full = path.join(specRoot, name);
      fs.mkdirSync(full, { recursive: true });
      return full;
    },
    check(label, passed, detail = "") {
      ctx.checks.push({
        label,
        passed: Boolean(passed),
        detail: String(detail),
      });
      return Boolean(passed);
    },
    // Runs `fn` and records any thrown error as a failed check, so later
    // checks in the same spec still run.
    async attempt(label, fn) {
      try {
        return await fn();
      } catch (error) {
        ctx.check(label, false, `threw: ${error.message}`);
        return undefined;
      }
    },
    note(text) {
      ctx.notes.push(text);
    },
    recordFile(label, file) {
      ctx.files.push({
        label,
        bytes: fs.statSync(file).size,
        sha256: sha256File(file),
      });
    },
    async launch({ seed, userDataDir, downloadDir } = {}) {
      launchCount += 1;
      const session = await launchApp({
        repoRoot,
        userDataDir: userDataDir || ctx.dir(`app${launchCount}-userdata`),
        downloadDir: downloadDir || ctx.dir(`app${launchCount}-downloads`),
        seed,
      });
      ctx.sessions.push(session);
      ctx.currentPage = session.page;
      ctx.notes.push(
        `launch ${launchCount}: userData honored=${session.userDataHonored}, background=${session.backgroundMode.enabled} (${session.userDataDir})`,
      );
      return session;
    },
    // Captured once per spec; a spec may call it early, before closing its app.
    async screenshot() {
      if (ctx.screenshotFile) return ctx.screenshotFile;
      if (!ctx.currentPage) return null;
      const file = path.join(ARTIFACTS_DIR, `${spec.id}.png`);
      try {
        await withTimeout(
          ctx.currentPage.screenshot({ path: file }),
          15_000,
          "screenshot timed out",
        );
        ctx.screenshotFile = file;
        return file;
      } catch (error) {
        ctx.notes.push(`screenshot failed: ${error.message}`);
        return null;
      }
    },
    async closeAll() {
      for (const session of ctx.sessions.reverse()) {
        await closeApp(session);
      }
      ctx.sessions = [];
    },
  };
  return ctx;
}

async function runSpec(spec, shared) {
  const specRoot = path.join(shared.runRoot, spec.id.toLowerCase());
  fs.mkdirSync(specRoot, { recursive: true });
  const ctx = createContext(spec, { ...shared, specRoot });
  const started = Date.now();
  let thrown = null;

  if (shared.setupError) {
    thrown = shared.setupError;
  } else {
    const running = Promise.resolve().then(() => spec.run(ctx));
    running.catch(() => {});
    try {
      await withTimeout(
        running,
        SPEC_TIMEOUT_MS,
        `Spec timed out after ${SPEC_TIMEOUT_MS / 1000} s.`,
      );
    } catch (error) {
      thrown = error;
    }
  }

  const screenshot = await ctx.screenshot();
  await ctx.closeAll();
  killProcessesWithTokens(ctx.tokens);

  const failures = ctx.checks
    .filter((c) => !c.passed)
    .map((c) => `${c.label}: ${c.detail}`);
  if (thrown) failures.push(thrown.message);
  const durationMs = Date.now() - started;
  return {
    id: spec.id,
    title: spec.title,
    failureModes: spec.failureModes || [],
    passed: failures.length === 0,
    failureMessage: failures.join("\n"),
    durationMs,
    screenshot,
    checks: ctx.checks,
    notes: ctx.notes,
    files: ctx.files,
  };
}

async function main() {
  const started = Date.now();
  fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rosi-e2e-"));
  let server = null;
  let environment = {};
  let setupError = null;
  let fixtures = null;
  const specResults = [];
  const specs = loadSpecs();
  const allTokens = [];

  try {
    let tools = {};
    try {
      tools = requireTools();
      fixtures = generateFixtures(path.join(runRoot, "fixtures"));
      server = await startFixtureServer(fixtures.dir);
    } catch (error) {
      setupError = error.message;
    }
    try {
      environment = collectEnvironment(runRoot, tools);
    } catch (error) {
      environment = { ...tools, environmentError: error.message };
    }

    const shared = {
      repoRoot: REPO_ROOT,
      runRoot,
      server,
      fixtures,
      allTokens,
      setupError: setupError ? new Error(setupError) : null,
    };
    for (const spec of specs) {
      const result = await runSpec(spec, shared);
      specResults.push(result);
      const verdict = result.passed ? "PASS" : "FAIL";
      console.log(
        `[${verdict}] ${spec.id} ${spec.title} (${(result.durationMs / 1000).toFixed(1)} s)`,
      );
      if (!result.passed)
        console.log(
          `       ${result.failureMessage.split("\n").join("\n       ")}`,
        );
    }
  } finally {
    if (server) await server.close().catch(() => {});
    killProcessesWithTokens(allTokens);
    fs.rmSync(runRoot, { recursive: true, force: true });
  }

  const passed = specResults.filter((s) => s.passed).length;
  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    environment,
    setupError,
    summary: {
      total: specResults.length,
      passed,
      failed: specResults.length - passed,
    },
    specs: specResults,
  };
  writeReport(ARTIFACTS_DIR, report);
  console.log(`Report: ${path.join(ARTIFACTS_DIR, "report.md")}`);
  process.exitCode = report.summary.failed === 0 && !setupError ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
