const fs = require("fs");
const path = require("path");
const {
  completionCount,
  waitForCompletion,
  findProgressLine,
  startDownloadIpc,
} = require("../lib/electronApp");
const { sha256File, ytdlpOutputName } = require("../lib/files");

const TITLE = "テスト動画.mp4";
const EXPECTED_NAME = ytdlpOutputName(TITLE);

module.exports = {
  id: "S2",
  title: "Non-ASCII filename: reported path exists and matches the download",
  failureModes: ["F6", "F7"],
  async run(ctx) {
    const session = await ctx.launch();
    const { page, downloadDir } = session;

    const before = await completionCount(page);
    await startDownloadIpc(page, {
      url: ctx.url(TITLE),
      outputPath: downloadDir,
    });
    const status = await waitForCompletion(page, before);
    ctx.check(
      "download completes with success status",
      /Download complete/.test(status),
      status,
    );

    const identified = await findProgressLine(page, "Identified file:");
    const match = identified && /Identified file:\s*(.+)$/.exec(identified);
    const reported = match ? match[1].trim() : null;
    ctx.check(
      "app reports an identified file path",
      Boolean(reported),
      identified || "no line",
    );
    if (!reported) return;

    ctx.check(
      "reported path exists on disk",
      fs.existsSync(reported),
      reported,
    );
    ctx.check(
      "reported file is in the download dir",
      path.dirname(fs.realpathSync(reported)) === fs.realpathSync(downloadDir),
      path.dirname(reported),
    );
    ctx.check(
      "reported basename is the expected non-ASCII name",
      path.basename(reported) === EXPECTED_NAME,
      JSON.stringify(path.basename(reported)),
    );
    ctx.check(
      "name on disk matches the reported name",
      fs.readdirSync(downloadDir).includes(path.basename(reported)),
      fs.readdirSync(downloadDir).join(", "),
    );
    if (fs.existsSync(reported)) {
      ctx.check(
        "reported file is byte-for-byte the fixture",
        sha256File(reported) === ctx.fixtureSha(TITLE),
        reported,
      );
      ctx.recordFile(TITLE, reported);
    }
  },
};
