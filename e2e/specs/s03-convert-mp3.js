const fs = require("fs");
const path = require("path");
const {
  completionCount,
  waitForCompletion,
  waitForUiOutcome,
  startDownloadIpc,
} = require("../lib/electronApp");
const { probeCodec } = require("../lib/ffmpeg");
const { ytdlpOutputName } = require("../lib/files");

module.exports = {
  id: "S3",
  title: "Conversion to MP3 (UI attempt, plus persisted-settings conversion)",
  failureModes: ["F10"],
  async run(ctx) {
    const session = await ctx.launch();
    const { page, downloadDir } = session;

    // UI path: enable "Convert after download" and pick .mp3 in the sidebar.
    await ctx.attempt("UI conversion download starts", async () => {
      await page.click("#settingsBtn");
      await page.waitForSelector("#sidebar.open");
      await page.click("label:has(#convertToggle)");
      await page.selectOption("#convertFormat", "mp3");
      await page.click("#closeSidebar");
      ctx.check(
        "UI: convert toggle is on and format is mp3",
        (await page.isChecked("#convertToggle")) &&
          (await page.inputValue("#convertFormat")) === "mp3",
      );

      const before = await completionCount(page);
      await page.fill("#url", ctx.url("sample.mp4"));
      await page.click("#downloadBtn");
      const outcome = await waitForUiOutcome(page, before);
      ctx.check(
        "UI download with conversion starts",
        outcome.kind === "complete",
        outcome.kind === "complete"
          ? outcome.message
          : `${outcome.kind}: ${outcome.message}`,
      );
    });

    // Persisted-settings path: enable conversion in settings, then download
    // without per-request conversion options so the main process reads settings.
    const saved = await page.evaluate(() =>
      window.api.saveSettings({ convertEnabled: true, convertFormat: "mp3" }),
    );
    ctx.check(
      "settings saved with convertEnabled and mp3",
      saved && saved.ok === true,
      JSON.stringify(saved),
    );

    const before = await completionCount(page);
    await startDownloadIpc(page, {
      url: ctx.url("sample.mp4"),
      outputPath: downloadDir,
    });
    const status = await waitForCompletion(page, before, 90_000);
    ctx.check(
      "conversion reports success",
      /Conversion complete/.test(status),
      status,
    );

    const mp3 = path.join(downloadDir, ytdlpOutputName("sample.mp3"));
    const exists = fs.existsSync(mp3);
    ctx.check("sample.mp3 exists in download dir", exists, mp3);
    if (exists) {
      const codecs = probeCodec(mp3);
      ctx.check(
        "mp3 contains a single mp3 audio stream",
        codecs.join(",") === "mp3,audio",
        codecs.join(","),
      );
      ctx.recordFile(ytdlpOutputName("sample.mp3"), mp3);
    }
    ctx.check(
      "original download kept (keepOriginalAfterConvert default)",
      fs.existsSync(path.join(downloadDir, ytdlpOutputName("sample.mp4"))),
      "",
    );
  },
};
