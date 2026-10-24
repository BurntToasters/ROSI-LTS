import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import sanitize from "sanitize-filename";
import { dialog } from "electron";
import log from "electron-log/main";
import {
  spawnWithEnv,
  resolveFfmpegPath,
  ytdlpBinary,
  isWindows,
} from "./platform";
import { loadSettings } from "./settings";
import {
  buildFfmpegArgs,
  buildYtdlpArgs,
  resolveVideoEncoder,
} from "./download/commandBuilders";
import { isSafeHttpUrl } from "../utils/validation";
import {
  createDownloadLifecycleState,
  markDownloadCancelled,
  shouldEmitTerminalEvent,
  markTerminalEventEmitted,
  classifyDownloadExit,
} from "../utils/downloadLifecycle";
import {
  MAX_OUTPUT_BUFFER,
  MAX_ERROR_BUFFER,
  FORMAT_FETCH_TIMEOUT_MS,
} from "./constants";
import { killChildProcess } from "./processKill";
import type { ChildProcess } from "child_process";
import type {
  DownloadSession,
  DownloadRequestOptions,
  FormatsProcess,
  Settings,
} from "../types";

let ytdlpProcess: ChildProcess | null = null;
let ffmpegProcess: ChildProcess | null = null;
let activeDownloadSession: DownloadSession | null = null;
let downloadSessionCounter = 0;
let formatsProcess: FormatsProcess | null = null;

function isActiveSession(session: DownloadSession | null) {
  return Boolean(
    session && activeDownloadSession && activeDownloadSession.id === session.id,
  );
}

function createPrintFilePath(sessionId: number) {
  const suffix = crypto.randomBytes(6).toString("hex");
  return path.join(
    os.tmpdir(),
    `rosi-lts-${process.pid}-${sessionId}-${suffix}.txt`,
  );
}

function removePrintFile(session: DownloadSession) {
  try {
    fs.unlinkSync(session.printFilePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn(`Could not remove ${session.printFilePath}:`, error);
    }
  }
}

function takePrintedPath(session: DownloadSession): string {
  try {
    const filePath = fs
      .readFileSync(session.printFilePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .pop();
    if (!filePath) {
      throw new Error("Could not find a valid filepath in yt-dlp's output.");
    }
    return filePath;
  } finally {
    removePrintFile(session);
  }
}

function safeSend(
  sender: Electron.WebContents,
  channel: string,
  message: unknown,
) {
  if (sender && !sender.isDestroyed()) {
    sender.send(channel, message);
  }
}

function sendProgress(session: DownloadSession | null, message: string) {
  if (!session || !shouldEmitTerminalEvent(session.lifecycle)) return;
  if (!isActiveSession(session)) return;
  safeSend(session.sender, "progress", message);
}

function completeSession(
  session: DownloadSession | null,
  statusMessage: string,
  progressMessage: string | null = null,
) {
  if (session) removePrintFile(session);
  if (!session || !isActiveSession(session)) return;
  if (!shouldEmitTerminalEvent(session.lifecycle)) return;
  session.lifecycle = markTerminalEventEmitted(session.lifecycle);
  if (progressMessage) {
    safeSend(session.sender, "progress", progressMessage);
  }
  safeSend(session.sender, "complete", statusMessage);
  activeDownloadSession = null;
  ytdlpProcess = null;
  ffmpegProcess = null;
}

export function cancelActiveSession(notify = true) {
  if (!activeDownloadSession) return;
  const session = activeDownloadSession;
  session.lifecycle = markDownloadCancelled(session.lifecycle);
  killChildProcess(session.ffmpegProcess, "ffmpeg");
  killChildProcess(session.ytdlpProcess, "yt-dlp");
  session.ffmpegProcess = null;
  session.ytdlpProcess = null;
  removePrintFile(session);

  if (!isActiveSession(session)) return;

  if (notify) {
    completeSession(
      session,
      "⏹️ Cancelled.",
      "⏹️ Download/Conversion cancelled by user.",
    );
    return;
  }

  session.lifecycle = markTerminalEventEmitted(session.lifecycle);
  activeDownloadSession = null;
  ytdlpProcess = null;
  ffmpegProcess = null;
}

export function killAllProcesses() {
  killChildProcess(ytdlpProcess, "yt-dlp");
  killChildProcess(ffmpegProcess, "ffmpeg");
  ytdlpProcess = null;
  ffmpegProcess = null;
  if (formatsProcess) {
    formatsProcess.cancelled = true;
    killChildProcess(formatsProcess.proc, "formats");
    formatsProcess = null;
  }
  if (activeDownloadSession) removePrintFile(activeDownloadSession);
}

export function fetchFormats(ytdlpPath: string, url: string): Promise<string> {
  if (!isSafeHttpUrl(url)) {
    return Promise.reject("Invalid URL provided");
  }
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ytdlpPath)) {
      return reject(`yt-dlp binary not found at ${ytdlpPath}`);
    }
    if (formatsProcess?.proc && !formatsProcess.proc.killed) {
      formatsProcess.cancelled = true;
      killChildProcess(formatsProcess.proc, "formats");
    }
    const proc = spawnWithEnv(ytdlpPath, ["-F", url], {
      detached: !isWindows,
    });
    const entry: FormatsProcess = { proc, cancelled: false };
    formatsProcess = entry;
    let outputData = "";
    let errorData = "";
    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");

    const timeout = setTimeout(() => {
      entry.cancelled = true;
      killChildProcess(proc, "formats-timeout");
      reject(
        "Format fetch timed out after 60 seconds. The server may be slow or unresponsive.",
      );
    }, FORMAT_FETCH_TIMEOUT_MS);

    proc.stdout?.on("data", (data) => {
      if (outputData.length < MAX_OUTPUT_BUFFER) outputData += data;
    });
    proc.stderr?.on("data", (data) => {
      if (errorData.length < MAX_ERROR_BUFFER) errorData += data;
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      const wasCancelled = entry.cancelled;
      if (formatsProcess === entry) {
        formatsProcess = null;
      }
      if (wasCancelled) {
        reject("Format fetch cancelled.");
        return;
      }
      if (code === 0) {
        resolve(outputData);
      } else {
        reject(
          `yt-dlp exited with code ${code}.\nOutput:\n${outputData}\nError:\n${errorData}`,
        );
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      if (formatsProcess === entry) {
        formatsProcess = null;
      }
      reject(`Failed to start yt-dlp: ${err.message}`);
    });
  });
}

export function cancelFormats() {
  if (formatsProcess?.proc && !formatsProcess.proc.killed) {
    formatsProcess.cancelled = true;
    killChildProcess(formatsProcess.proc, "formats");
  }
}

async function runConversion(
  session: DownloadSession,
  downloadedFilePath: string,
  effectiveSettings: Settings,
  ffmpegCommand: string,
  mainWindow: Electron.BrowserWindow | null,
) {
  sendProgress(session, "⏳ Checking if conversion is needed...");
  try {
    const originalInputPath = downloadedFilePath;
    const originalFileName = path.basename(originalInputPath);
    let sanitizedFileName = sanitize(originalFileName);

    if (!sanitizedFileName || sanitizedFileName.trim() === "") {
      const ext = path.extname(originalFileName) || ".mp4";
      sanitizedFileName = `download_${Date.now()}${ext}`;
      sendProgress(
        session,
        `⚠️ Original filename contained only invalid characters. Using: ${sanitizedFileName}`,
      );
    }

    const sanitizedInputPath = path.join(
      path.dirname(originalInputPath),
      sanitizedFileName,
    );

    if (originalInputPath !== sanitizedInputPath) {
      fs.renameSync(originalInputPath, sanitizedInputPath);
      sendProgress(
        session,
        `Renamed to sanitized filename: ${sanitizedFileName}`,
      );
    }

    const inputPath = sanitizedInputPath;
    const inputFileExt = path.extname(inputPath);
    const inputFilename = path.basename(inputPath);
    const targetFormat = effectiveSettings.convertFormat || "mp4";
    const outputPath = inputPath.replace(/\.[^/.]+$/, `.${targetFormat}`);
    const outputFilename = path.basename(outputPath);

    if (inputFileExt.toLowerCase() === `.${targetFormat}`) {
      sendProgress(
        session,
        `ℹ️ Downloaded file is already ${targetFormat.toUpperCase()} (${inputFilename}). Skipping conversion.`,
      );
      completeSession(
        session,
        `✅ Done (Already ${targetFormat.toUpperCase()}).`,
      );
      return;
    }

    if (fs.existsSync(outputPath)) {
      sendProgress(
        session,
        `⚠️ Output file ${outputFilename} already exists. Overwriting.`,
      );
    }

    sendProgress(
      session,
      `🎬 Converting ${inputFilename} to ${targetFormat.toUpperCase()}...`,
    );

    const videoEncoder = await resolveVideoEncoder(effectiveSettings);
    if (!isActiveSession(session)) return;
    const useGpu = effectiveSettings.gpuAcceleration && videoEncoder !== "copy";

    if (useGpu) {
      sendProgress(session, `🖥️ Using GPU acceleration (${videoEncoder})`);
    }

    const ffmpegArgs = buildFfmpegArgs(
      inputPath,
      outputPath,
      targetFormat,
      videoEncoder,
    );

    ffmpegProcess = spawnWithEnv(ffmpegCommand, ffmpegArgs, {
      detached: !isWindows,
    });
    session.ffmpegProcess = ffmpegProcess;
    ffmpegProcess.stdout?.setEncoding("utf8");
    ffmpegProcess.stderr?.setEncoding("utf8");

    ffmpegProcess.stdout?.on("data", (data) => {
      if (!isActiveSession(session)) return;
      sendProgress(session, `[ffmpeg] ${data.toString().trim()}`);
    });
    ffmpegProcess.stderr?.on("data", (data) => {
      if (!isActiveSession(session)) return;
      sendProgress(session, `[ffmpeg] ${data.toString().trim()}`);
    });

    ffmpegProcess.on("close", (ffmpegCode) => {
      if (!isActiveSession(session)) return;
      session.ffmpegProcess = null;
      ffmpegProcess = null;
      const ffExitType = classifyDownloadExit(
        session.lifecycle,
        ffmpegCode ?? 1,
      );

      if (ffExitType === "cancelled") {
        completeSession(
          session,
          "⏹️ Cancelled.",
          "⏹️ Download/Conversion cancelled by user.",
        );
        return;
      }

      if (ffExitType === "success") {
        sendProgress(session, `🎉 Successfully converted to ${outputPath}`);
        const shouldDelete = !effectiveSettings.keepOriginalAfterConvert;
        const pathsDiffer = isWindows
          ? inputPath.toLowerCase() !== outputPath.toLowerCase()
          : inputPath !== outputPath;
        if (shouldDelete && pathsDiffer) {
          sendProgress(
            session,
            `Attempting to delete original file: ${inputFilename}`,
          );
          try {
            fs.unlinkSync(inputPath);
            sendProgress(session, `🗑️ Deleted original file: ${inputFilename}`);
          } catch (unlinkErr) {
            sendProgress(
              session,
              `⚠️ Could not delete original file: ${inputFilename} (${(unlinkErr as Error).message})`,
            );
          }
        } else if (effectiveSettings.keepOriginalAfterConvert) {
          sendProgress(
            session,
            `ℹ️ Keeping original file (${inputFilename}) as per settings.`,
          );
        } else if (!pathsDiffer) {
          sendProgress(
            session,
            `ℹ️ Input and output paths resolved to the same file (${inputPath}), cannot delete original.`,
          );
        }
        completeSession(session, "🎬 Conversion complete.");
      } else {
        sendProgress(
          session,
          `❌ Conversion failed: FFmpeg process exited with code ${ffmpegCode}`,
        );
        sendProgress(session, `   Check FFmpeg output above for details.`);
        completeSession(session, "❌ Conversion failed.");
      }
    });

    ffmpegProcess.on("error", (err) => {
      if (!isActiveSession(session)) return;
      session.ffmpegProcess = null;
      ffmpegProcess = null;
      if (classifyDownloadExit(session.lifecycle, 1) === "cancelled") {
        completeSession(
          session,
          "⏹️ Cancelled.",
          "⏹️ Download/Conversion cancelled by user.",
        );
        return;
      }
      if (err.message.includes("ENOENT")) {
        sendProgress(
          session,
          `❌ Failed to start conversion: FFmpeg not found at ${ffmpegCommand}. Ensure FFMPEG is installed and accessible.`,
        );
        completeSession(session, "❌ Conversion failed (FFMPEG not found).");
        if (mainWindow && !mainWindow.isDestroyed()) {
          dialog.showMessageBox(mainWindow, {
            type: "error",
            title: "FFMPEG Error",
            message: `Failed to start conversion: FFmpeg not found at ${ffmpegCommand}.`,
            detail:
              "Please ensure FFMPEG is installed and accessible, or set a custom FFmpeg path in Settings. See Help for more details.",
          });
        }
      } else {
        sendProgress(
          session,
          `❌ Failed to start conversion process: ${err.message}`,
        );
        completeSession(session, "❌ Conversion failed (ffmpeg spawn error).");
      }
    });
  } catch (err) {
    sendProgress(
      session,
      `❌ Error setting up conversion: ${(err as Error).message}`,
    );
    completeSession(session, "❌ Conversion failed (setup error).");
  }
}

export function startDownload(
  ytdlpPath: string,
  sender: Electron.WebContents,
  options: DownloadRequestOptions,
  mainWindow: Electron.BrowserWindow | null,
) {
  if (activeDownloadSession) {
    cancelActiveSession(false);
  }

  downloadSessionCounter += 1;
  const session: DownloadSession = {
    id: downloadSessionCounter,
    sender,
    lifecycle: createDownloadLifecycleState(),
    ytdlpProcess: null,
    ffmpegProcess: null,
    printFilePath: createPrintFilePath(downloadSessionCounter),
  };
  activeDownloadSession = session;

  const settings = loadSettings();
  const effectiveSettings: Settings = { ...settings };
  const ffmpegPath = resolveFfmpegPath(
    options.ffmpegPath || settings.ffmpegPath,
  );
  const ffmpegCommand = ffmpegPath || "ffmpeg";
  const ffmpegLocation = ffmpegPath ? path.dirname(ffmpegPath) : null;

  if (options.convertFormat !== undefined) {
    if (
      typeof options.convertFormat === "string" &&
      options.convertFormat.trim() !== ""
    ) {
      effectiveSettings.convertFormat = options.convertFormat;
      effectiveSettings.convertEnabled = true;
    } else {
      effectiveSettings.convertEnabled = false;
    }
  }
  if (typeof options.keepOriginal === "boolean") {
    effectiveSettings.keepOriginalAfterConvert = options.keepOriginal;
  }

  const url = options.url;
  const downloadDir = options.outputPath;

  if (!isSafeHttpUrl(url)) {
    sendProgress(session, "⚠️ Invalid or missing URL.");
    completeSession(session, "❌ Failed (Invalid URL).");
    return;
  }
  if (
    !downloadDir ||
    typeof downloadDir !== "string" ||
    downloadDir.trim() === ""
  ) {
    sendProgress(session, "⚠️ Invalid or missing download folder.");
    completeSession(session, "❌ Failed (Invalid Folder).");
    return;
  }
  if (!fs.existsSync(ytdlpPath)) {
    sendProgress(session, `❌ Error: yt-dlp binary not found at ${ytdlpPath}`);
    completeSession(session, "❌ Failed (Missing Dependency).");
    return;
  }

  try {
    const normalizedDownloadDir = path.resolve(downloadDir);
    if (!fs.existsSync(normalizedDownloadDir)) {
      sendProgress(session, `📂 Creating directory: ${normalizedDownloadDir}`);
      fs.mkdirSync(normalizedDownloadDir, { recursive: true });
    } else {
      const stats = fs.statSync(normalizedDownloadDir);
      if (!stats.isDirectory()) {
        sendProgress(
          session,
          `❌ Download path is not a directory: ${normalizedDownloadDir}`,
        );
        completeSession(session, "❌ Failed (Invalid Folder).");
        return;
      }
    }

    const { args: ytdlpArgs, statusMessages } = buildYtdlpArgs({
      normalizedDownloadDir,
      url,
      settings: effectiveSettings,
      options,
      ffmpegLocation,
      printFilePath: session.printFilePath,
    });
    statusMessages.forEach((message) => sendProgress(session, message));

    sendProgress(session, `🚀 Starting download: ${url}`);
    sendProgress(session, `   Command: ${ytdlpBinary} ${ytdlpArgs.join(" ")}`);
    ytdlpProcess = spawnWithEnv(ytdlpPath, ytdlpArgs, {
      env: { PYTHONUNBUFFERED: "1" },
      detached: !isWindows,
    });
    session.ytdlpProcess = ytdlpProcess;
    ytdlpProcess.stdout?.setEncoding("utf8");
    ytdlpProcess.stderr?.setEncoding("utf8");

    let downloadErrorData = "";

    ytdlpProcess.stdout?.on("data", (data) => {
      if (!isActiveSession(session)) return;
      sendProgress(session, data.toString().trim());
    });

    ytdlpProcess.stderr?.on("data", (data) => {
      if (!isActiveSession(session)) return;
      const message = data.toString();
      if (downloadErrorData.length < MAX_ERROR_BUFFER) {
        downloadErrorData += message;
      }
      sendProgress(session, `[yt-dlp stderr] ${message.trim()}`);
    });

    ytdlpProcess.on("close", (code) => {
      if (!isActiveSession(session)) {
        removePrintFile(session);
        return;
      }
      session.ytdlpProcess = null;
      ytdlpProcess = null;

      const exitType = classifyDownloadExit(session.lifecycle, code ?? 1);
      if (exitType === "cancelled") {
        completeSession(
          session,
          "⏹️ Cancelled.",
          "⏹️ Download/Conversion cancelled by user.",
        );
        return;
      }

      if (exitType === "failed") {
        sendProgress(
          session,
          `❌ Download failed: yt-dlp process exited with code ${code}`,
        );
        if (
          downloadErrorData.includes("different Team IDs") ||
          downloadErrorData.includes("[PYI-") ||
          downloadErrorData.includes("Failed to load Python shared library")
        ) {
          sendProgress(
            session,
            "   macOS blocked the bundled yt-dlp runtime (code signing). Install yt-dlp via Homebrew as a workaround, or use a rebuilt ROSI-LTS release with signed helpers.",
          );
        }
        sendProgress(
          session,
          `   Check console and stderr output above for details.`,
        );
        completeSession(session, "❌ Download failed.");
        return;
      }

      let downloadedFilePath: string;
      try {
        downloadedFilePath = takePrintedPath(session);
        sendProgress(
          session,
          `✅ Download finished. Identified file: ${downloadedFilePath}`,
        );
      } catch (extractError) {
        sendProgress(
          session,
          `❌ Error determining downloaded file path after download.`,
        );
        sendProgress(session, `   Error: ${(extractError as Error).message}`);
        completeSession(session, "❌ Failed (File Path Error).");
        return;
      }

      if (effectiveSettings.convertEnabled) {
        void runConversion(
          session,
          downloadedFilePath,
          effectiveSettings,
          ffmpegCommand,
          mainWindow,
        );
      } else {
        sendProgress(session, "ℹ️ Conversion not enabled for this download.");
        completeSession(session, "✅ Download complete (no conversion).");
      }
    });

    ytdlpProcess.on("error", (err) => {
      if (!isActiveSession(session)) return;
      session.ytdlpProcess = null;
      ytdlpProcess = null;
      if (classifyDownloadExit(session.lifecycle, 1) === "cancelled") {
        completeSession(
          session,
          "⏹️ Cancelled.",
          "⏹️ Download/Conversion cancelled by user.",
        );
        return;
      }
      sendProgress(
        session,
        `❌ Failed to start download process: ${err.message}`,
      );
      completeSession(session, "❌ Download failed (process spawn error).");
    });
  } catch (error) {
    sendProgress(
      session,
      `❌ Error before starting download: ${(error as Error).message}`,
    );
    completeSession(session, "❌ Failed (Initial Setup Error).");
  }
}
