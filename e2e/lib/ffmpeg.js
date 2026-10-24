const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { sha256File } = require("./files");

const COMMON_ARGS = ["-hide_banner", "-loglevel", "error", "-y"];

const ENCODE_ARGS = [
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-shortest",
  // Deterministic output so fixture hashes are stable across runs.
  "-fflags",
  "+bitexact",
  "-flags",
  "+bitexact",
  "-map_metadata",
  "-1",
  "-movflags",
  "+faststart",
];

function toolVersion(tool) {
  const result = spawnSync(tool, ["-version"], { encoding: "utf8" });
  if (result.error && result.error.code === "ENOENT") {
    throw new Error(
      `${tool} was not found on PATH. The E2E fixtures need system ffmpeg and ffprobe. Install ffmpeg (for example: brew install ffmpeg) and re-run npm run test:e2e.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${tool} -version failed: ${result.stderr || result.error}`,
    );
  }
  return result.stdout.split("\n")[0].trim();
}

function requireTools() {
  return {
    ffmpeg: toolVersion("ffmpeg"),
    ffprobe: toolVersion("ffprobe"),
  };
}

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", [...COMMON_ARGS, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg failed (exit ${result.status}): ${result.stderr || result.error}`,
    );
  }
}

// Generates every fixture the specs need into `dir` and returns a map of
// fixture name -> sha256 so specs can compare downloaded bytes.
function generateFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true });

  const sample = path.join(dir, "sample.mp4");
  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=3:size=320x240:rate=25",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=3",
    ...ENCODE_ARGS,
    sample,
  ]);

  // ~3.8 MB: at the throttled 50 KB/s this takes roughly 75 s, which leaves
  // a long window to cancel or quit mid-download.
  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=duration=60:size=640x360:rate=25",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=60",
    "-b:v",
    "400k",
    "-maxrate",
    "400k",
    "-bufsize",
    "800k",
    "-b:a",
    "96k",
    ...ENCODE_ARGS,
    path.join(dir, "big.mp4"),
  ]);

  // Same bytes under other names. ffmpeg probes content, so the name only
  // controls the filename yt-dlp chooses for the download.
  const unicodeName = "テスト動画.mp4";
  const escapeName = "sample-escape.mkv";
  fs.copyFileSync(sample, path.join(dir, unicodeName));
  fs.copyFileSync(sample, path.join(dir, escapeName));

  const names = ["sample.mp4", "big.mp4", unicodeName, escapeName];
  const sha256 = {};
  for (const name of names) {
    sha256[name] = sha256File(path.join(dir, name));
  }
  return { dir, names, sha256 };
}

function probeCodec(file) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,codec_type",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffprobe failed for ${file}: ${result.stderr}`);
  }
  return result.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim());
}

module.exports = { requireTools, generateFixtures, probeCodec };
