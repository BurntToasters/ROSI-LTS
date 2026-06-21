import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import { app, dialog } from "electron";
import log from "electron-log/main";

export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";
export const isLinux = process.platform === "linux";
export const isArm64 = process.arch === "arm64";
export const isPackaged = app.isPackaged;

export function buildEnhancedPath() {
  const currentPath = process.env.PATH || "";

  if (isWindows) {
    const userProfile = process.env.USERPROFILE || "";
    const localAppData = process.env.LOCALAPPDATA || "";
    const extraPaths = [
      path.join(userProfile, ".deno", "bin"),
      path.join(localAppData, "deno", "bin"),
      "C:\\Program Files\\ffmpeg\\bin",
      "C:\\ffmpeg\\bin",
      "C:\\Program Files\\deno",
      "C:\\deno",
    ];
    return [...extraPaths, currentPath].filter(Boolean).join(";");
  }

  const homeDir = process.env.HOME || "";
  const extraPaths = [
    path.join(homeDir, ".deno", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    "/home/linuxbrew/.linuxbrew/bin",
    path.join(homeDir, ".local", "bin"),
  ];

  return [...extraPaths, currentPath].filter(Boolean).join(":");
}

export function spawnWithEnv(
  command: string,
  args: string[],
  options: Record<string, unknown> = {},
) {
  const baseEnv = (options.env as Record<string, string> | undefined) || {};
  return spawn(command, args, {
    ...options,
    env: { ...process.env, ...baseEnv, PATH: buildEnhancedPath() },
  } as Parameters<typeof spawn>[2]);
}

export function resolveFfmpegPath(customPath: unknown): string | null {
  if (!customPath || typeof customPath !== "string") return null;
  const trimmed = customPath.trim();
  if (!trimmed) return null;

  let candidate = trimmed;

  try {
    if (fs.existsSync(candidate)) {
      const stats = fs.statSync(candidate);
      if (stats.isDirectory()) {
        candidate = path.join(candidate, isWindows ? "ffmpeg.exe" : "ffmpeg");
      }
    } else if (isWindows && path.extname(candidate) === "") {
      const withExe = `${candidate}.exe`;
      if (fs.existsSync(withExe)) {
        candidate = withExe;
      }
    }
  } catch {
    return trimmed;
  }

  return candidate;
}

function getYtdlpBinaryName() {
  if (isWindows) return isArm64 ? "yt-dlp_arm64.exe" : "yt-dlp.exe";
  if (isMac) return "yt-dlp_macos";
  if (isLinux) return isArm64 ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
  return "yt-dlp_linux";
}

export const ytdlpBinary = getYtdlpBinaryName();

let effectiveYtdlpPath: string | null = null;

const MAX_PROBE_BUFFER = 4096;

function safeHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

function findMacSystemYtdlpPath(): string | null {
  if (!isMac) return null;

  const homeDir = safeHomeDir();
  const candidates = [
    path.join(homeDir, ".local", "bin", "yt-dlp"),
    "/opt/homebrew/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const stats = fs.statSync(candidate);
        if (stats.isFile()) return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

function probeYtdlpBinary(
  ytdlpPath: string,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    let stdout = "";
    const proc = spawn(ytdlpPath, ["--version"], {
      env: { ...process.env, PATH: buildEnhancedPath() },
      shell: false,
    });

    proc.stdout?.on("data", (data: Buffer) => {
      if (stdout.length < 512) stdout += data.toString();
    });
    proc.stderr?.on("data", (data: Buffer) => {
      if (stderr.length < MAX_PROBE_BUFFER) stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, detail: stdout.trim() || stderr.trim() });
        return;
      }
      resolve({
        ok: false,
        detail: stderr.trim() || stdout.trim() || `exit code ${code}`,
      });
    });

    proc.on("error", (err: Error) => {
      resolve({ ok: false, detail: err.message });
    });
  });
}

function resolveBundledYtdlpPath(): string {
  let resolved = "";

  if (isPackaged) {
    const possiblePaths = [
      path.join(process.resourcesPath, "assets", ytdlpBinary),
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "assets",
        ytdlpBinary,
      ),
      path.join(__dirname, "..", "..", "assets", ytdlpBinary),
    ];

    for (const tryPath of possiblePaths) {
      log.info(`Trying yt-dlp path: ${tryPath}`);
      if (fs.existsSync(tryPath)) {
        resolved = tryPath;
        log.info(`Found yt-dlp at: ${resolved}`);
        break;
      }
    }

    if (!resolved) {
      log.error(`Could not find ${ytdlpBinary} in any expected location`);
      resolved = path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "assets",
        ytdlpBinary,
      );
    }
  } else {
    resolved = path.join(__dirname, "..", "..", "assets", ytdlpBinary);
  }

  if (!isWindows && fs.existsSync(resolved)) {
    try {
      fs.chmodSync(resolved, 0o755);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EROFS" || code === "EACCES") {
        try {
          fs.accessSync(resolved, fs.constants.X_OK);
        } catch {
          try {
            const tmpDir = path.join(app.getPath("temp"), "rosi-lts-bin");
            if (!fs.existsSync(tmpDir))
              fs.mkdirSync(tmpDir, { recursive: true });
            const tmpBin = path.join(tmpDir, ytdlpBinary);
            fs.copyFileSync(resolved, tmpBin);
            fs.chmodSync(tmpBin, 0o755);
            resolved = tmpBin;
          } catch (copyErr) {
            log.error(
              `Failed to prepare yt-dlp for execution at ${resolved}: ${(copyErr as Error).message}`,
            );
          }
        }
      } else {
        dialog.showErrorBox(
          "Permission Error",
          `Failed to set executable permissions on yt-dlp binary at ${resolved}.\nError: ${(err as Error).message}`,
        );
        app.quit();
      }
    }
  }

  if (!fs.existsSync(resolved)) {
    log.error(`yt-dlp binary not found at ${resolved}`);
  }

  return resolved;
}

export function resolveYtdlpPath(): string {
  return effectiveYtdlpPath ?? resolveBundledYtdlpPath();
}

export async function initializeYtdlpPath(): Promise<string> {
  if (effectiveYtdlpPath) return effectiveYtdlpPath;

  const bundled = resolveBundledYtdlpPath();
  if (!isMac || !isPackaged) {
    effectiveYtdlpPath = bundled;
    return bundled;
  }

  const bundledProbe = await probeYtdlpBinary(bundled);
  if (bundledProbe.ok) {
    log.info(
      `Bundled yt-dlp verified: ${bundledProbe.detail.split("\n")[0] ?? bundledProbe.detail}`,
    );
    effectiveYtdlpPath = bundled;
    return bundled;
  }

  log.warn(
    `Bundled yt-dlp failed startup check at ${bundled}: ${bundledProbe.detail}`,
  );

  const systemPath = findMacSystemYtdlpPath();
  if (systemPath) {
    const systemProbe = await probeYtdlpBinary(systemPath);
    if (systemProbe.ok) {
      log.info(`Using system yt-dlp fallback at ${systemPath}`);
      effectiveYtdlpPath = systemPath;
      return systemPath;
    }
    log.warn(
      `System yt-dlp failed startup check at ${systemPath}: ${systemProbe.detail}`,
    );
  }

  effectiveYtdlpPath = bundled;
  return bundled;
}
