import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  shell,
  Notification,
} from "electron";
import * as path from "path";
import * as fs from "fs";
import log from "electron-log/main";
import { isPackaged, initializeYtdlpPath } from "./platform";
import { loadSettings, saveSettings, getDefaultSettings } from "./settings";
import {
  setupAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  cancelUpdateDownload,
  installUpdate,
} from "./updater";
import { checkDenoInstalled, installDeno } from "./deno";
import { detectGpu } from "./gpu";
import {
  startDownload,
  cancelActiveSession,
  killAllProcesses,
  fetchFormats,
  cancelFormats,
} from "./downloader";
import {
  isSafeExternalUrl,
  isSafeHttpUrl,
  isAllowedNavigationUrl,
} from "../utils/validation";
import {
  errorResult,
  okResult,
  validateDownloadRequestPayload,
  validateExternalUrlPayload,
  validateFileLocationPayload,
  validateNotificationPayload,
  validateSettingsPatchPayload,
} from "../utils/ipcValidation";
import { SPLASH_SHOW_DELAY_MS, SPLASH_FADE_DELAY_MS } from "./constants";
import type { DownloadRequestOptions } from "../types";

log.initialize();

// Set by the E2E runner so macOS launches stay in the background.
const e2eBackground =
  !app.isPackaged &&
  process.platform === "darwin" &&
  process.env.ROSI_LTS_E2E_BACKGROUND === "1";
if (e2eBackground) app.setActivationPolicy("accessory");

let ytdlpPath = "";

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

const rendererDir = path.join(__dirname, "..", "..", "src", "renderer");

function getMainWindow() {
  return mainWindow;
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 360,
    transparent: true,
    frame: false,
    alwaysOnTop: !e2eBackground,
    show: !e2eBackground,
    icon: path.join(__dirname, "..", "..", "src", "renderer", "app.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    roundedCorners: true,
  });
  splashWindow.loadFile(
    path.join(__dirname, "..", "..", "src", "renderer", "splash.html"),
  );
  splashWindow.center();
}

function createWindow() {
  const isDev =
    process.env.NODE_ENV === "development" || process.argv.includes("--dev");
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    maxWidth: 1800,
    maxHeight: 1400,
    icon: path.join(__dirname, "..", "..", "src", "renderer", "app.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: isDev,
      backgroundThrottling: !e2eBackground,
      sandbox: true,
    },
    autoHideMenuBar: !isDev,
    show: false,
  });
  mainWindow.loadFile(
    path.join(__dirname, "..", "..", "src", "renderer", "index.html"),
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch((err) => {
        log.error("Failed to open external URL:", err);
      });
    }
    return { action: "deny" as const };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigationUrl(url, rendererDir)) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) {
        shell.openExternal(url).catch((err) => {
          log.error("Failed to open external URL:", err);
        });
      }
    }
  });

  mainWindow.setMenuBarVisibility(isDev);
  mainWindow.setAutoHideMenuBar(!isDev);

  if (!isDev) {
    mainWindow.removeMenu();
  }

  mainWindow.once("ready-to-show", () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (e2eBackground) {
          mainWindow.setOpacity(0);
          mainWindow.setIgnoreMouseEvents(true);
          mainWindow.setFocusable(false);
          mainWindow.showInactive();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    }, SPLASH_FADE_DELAY_MS);
  });
}

// Deny every renderer permission request and check. Notifications are shown
// by the main-process Notification class, which these handlers do not affect.
function configureSessionSecurity() {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}

// Applies to every window and webview. The main window sets its own
// window-open handler after this runs, which replaces the deny default.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" as const }));
});

void app.whenReady().then(async () => {
  configureSessionSecurity();
  ytdlpPath = await initializeYtdlpPath();
  if (!fs.existsSync(ytdlpPath)) {
    dialog.showErrorBox(
      "Missing Dependency",
      `yt-dlp binary not found at ${ytdlpPath}.\nPlease ensure the yt-dlp binary is in the application's directory, or install yt-dlp via Homebrew.`,
    );
    app.quit();
    return;
  }

  createSplashWindow();
  setTimeout(() => {
    createWindow();
  }, SPLASH_SHOW_DELAY_MS);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  killAllProcesses();
});

setupAutoUpdater(getMainWindow, loadSettings);

ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("is-packaged", () => isPackaged);
ipcMain.handle("check-for-updates", () =>
  checkForUpdates(isPackaged, loadSettings),
);
ipcMain.handle("download-update", () => downloadUpdate());
ipcMain.on("cancel-update-download", () => cancelUpdateDownload(getMainWindow));
ipcMain.on("install-update", () => installUpdate());

ipcMain.handle("check-deno-installed", () => checkDenoInstalled());
ipcMain.handle("install-deno", () => installDeno(mainWindow));

ipcMain.handle("get-settings", () => loadSettings());
ipcMain.handle("save-settings", (_, data) => {
  const validation = validateSettingsPatchPayload(data);
  if (!validation.ok) {
    return errorResult(
      validation.error.code,
      validation.error.message,
      validation.error.details,
    );
  }

  const saved = saveSettings(validation.data, mainWindow);
  if (!saved) {
    return errorResult("INTERNAL_ERROR", "Failed to persist settings.");
  }
  return okResult(loadSettings());
});

ipcMain.handle("detect-gpu", () => detectGpu());

ipcMain.on("reset-settings", () => {
  try {
    const saved = saveSettings(getDefaultSettings(), mainWindow);
    if (!saved) {
      log.error("Failed to save default settings during reset-settings.");
    }
    app.relaunch();
    app.exit();
  } catch (error) {
    log.error("Error resetting settings:", error);
    app.relaunch();
    app.exit();
  }
});

ipcMain.handle("open-external", async (_, url) => {
  const validation = validateExternalUrlPayload(url);
  if (!validation.ok) {
    return errorResult(
      validation.error.code,
      validation.error.message,
      validation.error.details,
    );
  }

  try {
    await shell.openExternal(validation.data);
    return okResult({ opened: true });
  } catch (error) {
    log.error("Error in open-external handler:", error);
    return errorResult("INTERNAL_ERROR", "Failed to open external URL.");
  }
});

ipcMain.handle("select-download-location", async () => {
  try {
    const defaultPath = app.getPath("downloads");
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const parentWindow =
      focusedWindow ||
      (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    if (!parentWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow, {
      title: "Select Download Folder",
      defaultPath,
      properties: ["openDirectory", "createDirectory"],
    });
    return canceled ? null : filePaths[0];
  } catch (error) {
    log.error("Error in select-download-location:", error);
    return null;
  }
});

ipcMain.handle("getFormats", (_, url) => {
  if (typeof url !== "string" || !isSafeHttpUrl(url)) {
    return Promise.reject("Invalid URL provided");
  }
  return fetchFormats(ytdlpPath, url);
});
ipcMain.on("cancel-formats", () => cancelFormats());

ipcMain.handle("download-video", (event, options) => {
  const validation = validateDownloadRequestPayload(options);
  if (!validation.ok) {
    return errorResult(
      validation.error.code,
      validation.error.message,
      validation.error.details,
    );
  }

  try {
    startDownload(
      ytdlpPath,
      event.sender,
      validation.data as DownloadRequestOptions,
      mainWindow,
    );
    return okResult({ started: true });
  } catch (error) {
    log.error("Error in download-video handler:", error);
    return errorResult("INTERNAL_ERROR", "Failed to start download.");
  }
});

ipcMain.on("cancel-download", () => {
  try {
    cancelActiveSession(true);
  } catch (error) {
    log.error("Error in cancel-download handler:", error);
  }
});

ipcMain.handle("restart-app", () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle("open-file-location", async (_, filePath) => {
  const validation = validateFileLocationPayload(filePath);
  if (!validation.ok) {
    return errorResult(
      validation.error.code,
      validation.error.message,
      validation.error.details,
    );
  }

  try {
    if (fs.existsSync(validation.data)) {
      shell.showItemInFolder(validation.data);
      return okResult({ opened: true });
    }

    const dir = path.dirname(validation.data);
    if (fs.existsSync(dir)) {
      await shell.openPath(dir);
      return okResult({ opened: true });
    }

    return errorResult(
      "INVALID_PATH",
      "Path and containing directory do not exist.",
    );
  } catch (error) {
    log.error("Error in open-file-location handler:", error);
    return errorResult("INTERNAL_ERROR", "Failed to open file location.");
  }
});

ipcMain.handle("show-notification", (_, options) => {
  const validation = validateNotificationPayload(options);
  if (!validation.ok) {
    return errorResult(
      validation.error.code,
      validation.error.message,
      validation.error.details,
    );
  }

  try {
    if (!Notification.isSupported()) {
      return errorResult(
        "NOT_SUPPORTED",
        "Notifications are not supported in this environment.",
      );
    }

    const notification = new Notification({
      title: validation.data.title || "ROSI-LTS",
      body: validation.data.body || "",
      icon: path.join(__dirname, "..", "..", "src", "renderer", "app.png"),
      silent: false,
    });

    notification.on("click", () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed() && !e2eBackground) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
        if (validation.data.filePath) {
          shell.showItemInFolder(validation.data.filePath);
        }
      } catch (clickErr) {
        log.error("Error handling notification click:", clickErr);
      }
    });

    notification.show();
    return okResult({ shown: true });
  } catch (error) {
    log.error("Error showing notification:", error);
    return errorResult("INTERNAL_ERROR", "Failed to show notification.");
  }
});
