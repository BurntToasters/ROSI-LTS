const fs = require("fs");
const path = require("path");
const {
  completionCount,
  waitForCompletion,
  waitForUiOutcome,
  startDownloadIpc,
} = require("../lib/electronApp");
const { sha256File } = require("../lib/files");

module.exports = {
  id: "S1",
  title: "Basic direct MP4 download",
  failureModes: ["F10"],
  async run(ctx) {
    const session = await ctx.launch();
    const { page, downloadDir } = session;

    ctx.check(
      "--user-data-dir honored (Electron userData is the isolated dir)",
      session.userDataHonored,
      session.userDataDir,
    );

    // UI path: type the URL and press the download button.
    await ctx.attempt("UI download starts", async () => {
      const before = await completionCount(page);
      await page.fill("#url", ctx.url("sample.mp4"));
      await page.click("#downloadBtn");
      const outcome = await waitForUiOutcome(page, before);
      ctx.check(
        "UI download button starts a download",
        outcome.kind === "complete",
        outcome.kind === "complete" ? outcome.message : `${outcome.kind}: ${outcome.message}`,
      );
    });

    // Main-process path: same IPC the UI uses, with unused fields omitted.
    const before = await completionCount(page);
    await startDownloadIpc(page, { url: ctx.url("sample.mp4"), outputPath: downloadDir });
    const status = await waitForCompletion(page, before);
    ctx.check("download completes with success status", /Download complete/.test(status), status);

    const file = path.join(downloadDir, "sample.mp4");
    const exists = fs.existsSync(file);
    ctx.check("downloaded file exists in download dir", exists, file);
    if (exists) {
      ctx.check(
        "downloaded bytes match fixture",
        sha256File(file) === ctx.fixtureSha("sample.mp4"),
        file,
      );
      ctx.recordFile("sample.mp4", file);
    }
  },
};
