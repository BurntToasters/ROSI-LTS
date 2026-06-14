'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Re-sign bundled yt-dlp after electron-builder signs the app.
 * PyInstaller sidecars extract a Python runtime at launch; without
 * disable-library-validation they fail with Team ID mismatches on macOS.
 */
exports.default = async function signMacHelpers(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const entitlements = path.join(__dirname, '..', 'build', 'entitlements.helper.plist');
  if (!fs.existsSync(entitlements)) {
    console.warn(`[sign-mac-helpers] Entitlements not found: ${entitlements}`);
    return;
  }

  const identity = process.env.CSC_NAME || process.env.APPLE_SIGNING_IDENTITY;
  if (!identity) {
    console.warn('[sign-mac-helpers] No signing identity found; skipping helper re-sign');
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const ytdlpPath = path.join(appPath, 'Contents', 'Resources', 'assets', 'yt-dlp_macos');

  if (!fs.existsSync(ytdlpPath)) {
    console.log(`[sign-mac-helpers] Skipping missing helper: ${ytdlpPath}`);
    return;
  }

  console.log(`[sign-mac-helpers] Signing ${ytdlpPath}`);
  execFileSync(
    'codesign',
    [
      '--force',
      '--options',
      'runtime',
      '--entitlements',
      entitlements,
      '--sign',
      identity,
      ytdlpPath,
    ],
    { stdio: 'inherit' }
  );
};
